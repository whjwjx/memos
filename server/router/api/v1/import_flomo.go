package v1

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/labstack/echo/v5"
	"golang.org/x/net/html"

	"github.com/usememos/memos/store"
)

const (
	flomoTimeLayout = "2006-01-02 15:04:05"
)

type flomoImportData struct {
	Memos       []importExportMemoRecord
	Attachments []importAttachmentInput
	Warnings    []string
}

type flomoMediaReference struct {
	Kind       string
	Src        string
	Transcript string
}

func findFlomoHTMLZipEntry(zipReader *zip.Reader) *zip.File {
	for _, file := range zipReader.File {
		if file.FileInfo().IsDir() || !strings.EqualFold(path.Ext(file.Name), ".html") {
			continue
		}
		blob, err := readZipEntry(file)
		if err != nil {
			continue
		}
		lower := strings.ToLower(string(blob))
		if strings.Contains(lower, `class="memo"`) && strings.Contains(lower, `class="content"`) && strings.Contains(lower, `class="time"`) {
			return file
		}
	}
	return nil
}

func (s *APIV1Service) importFlomoZip(
	ctx context.Context,
	user *store.User,
	scope importExportScope,
	zipFilePath string,
	htmlEntryName string,
) (*importExportResult, error) {
	zipReader, err := zip.OpenReader(zipFilePath)
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "invalid import zip").Wrap(err)
	}
	defer zipReader.Close()

	data, err := parseFlomoZip(&zipReader.Reader, htmlEntryName, user.Username)
	if err != nil {
		return nil, err
	}

	result := &importExportResult{Source: string(importSourceFlomo), Scope: string(scope)}
	for _, warning := range data.Warnings {
		addImportExportWarning(&result.Warnings, warning)
	}
	userIDs := map[string]int32{
		"":            user.ID,
		user.Username: user.ID,
	}
	uidMapper := newImportUIDMapper(user, scope)
	attachmentRecords := make([]importExportAttachmentRecord, 0, len(data.Attachments))
	for _, input := range data.Attachments {
		attachmentRecords = append(attachmentRecords, input.Record)
	}
	attachmentUIDMap, err := s.buildImportAttachmentUIDMap(ctx, attachmentRecords, userIDs, scope, uidMapper)
	if err != nil {
		return nil, err
	}
	memoIDsByUID, err := s.importMemosFromRecords(ctx, data.Memos, userIDs, scope, uidMapper, attachmentUIDMap, result)
	if err != nil {
		return nil, err
	}
	if err := s.importAttachmentsFromRecords(ctx, data.Attachments, userIDs, scope, uidMapper, memoIDsByUID, result); err != nil {
		return nil, err
	}
	return result, nil
}

func parseFlomoZip(zipReader *zip.Reader, htmlEntryName, username string) (*flomoImportData, error) {
	entries := zipEntriesByCleanName(zipReader)
	htmlEntry := entries[cleanZipEntryName(htmlEntryName)]
	if htmlEntry == nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "flomo html file not found")
	}
	htmlBlob, err := readZipEntry(htmlEntry)
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "failed to read flomo html").Wrap(err)
	}
	document, err := html.Parse(bytes.NewReader(htmlBlob))
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "failed to parse flomo html").Wrap(err)
	}

	memoNodes := findAllNodesByClass(document, "memo")
	if len(memoNodes) == 0 {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "flomo memo list is empty")
	}

	location := flomoImportLocation()
	htmlBaseDir := path.Dir(cleanZipEntryName(htmlEntry.Name))
	if htmlBaseDir == "." {
		htmlBaseDir = ""
	}

	data := &flomoImportData{
		Memos:       make([]importExportMemoRecord, 0, len(memoNodes)),
		Attachments: []importAttachmentInput{},
	}
	for index, memoNode := range memoNodes {
		timeText := strings.TrimSpace(nodeText(firstNodeByClass(memoNode, "time")))
		createdAt, err := time.ParseInLocation(flomoTimeLayout, timeText, location)
		if err != nil {
			createdAt = time.Now()
			data.Warnings = append(data.Warnings, fmt.Sprintf("memo %d: invalid flomo time %q", index+1, timeText))
		}
		content := renderFlomoContent(firstNodeByClass(memoNode, "content"))
		mediaRefs := collectFlomoMediaReferences(memoNode)
		memoUID := stableImportUID("flomo", timeText, content, fmt.Sprintf("%d", index))

		for mediaIndex, media := range mediaRefs {
			zipEntryName, ok := resolveFlomoZipEntryName(htmlBaseDir, media.Src)
			if !ok {
				data.Warnings = append(data.Warnings, fmt.Sprintf("%s: unsafe flomo attachment path %q", memoUID, media.Src))
				continue
			}
			zipEntry := entries[zipEntryName]
			if zipEntry == nil {
				data.Warnings = append(data.Warnings, fmt.Sprintf("%s: flomo attachment missing: %s", memoUID, media.Src))
				continue
			}
			blob, err := readZipEntry(zipEntry)
			if err != nil {
				return nil, echo.NewHTTPError(http.StatusBadRequest, "failed to read flomo attachment").Wrap(err)
			}
			filename := safeImportFilename(path.Base(zipEntryName), media.Kind, mediaIndex)
			attachmentUID := stableImportUID("flomo-att", zipEntryName, hexSha256(blob))
			mimeType := http.DetectContentType(blob)
			if extType := mimeTypeByExtension(filename); extType != "" {
				mimeType = extType
			}
			data.Attachments = append(data.Attachments, importAttachmentInput{
				Record: importExportAttachmentRecord{
					UID:             attachmentUID,
					CreatorUsername: username,
					Filename:        filename,
					Type:            mimeType,
					Size:            int64(len(blob)),
					MemoUID:         memoUID,
					Sha256:          hexSha256(blob),
				},
				Blob: blob,
			})
			content = appendFlomoAttachmentMarkdown(content, media, attachmentUID, filename)
		}
		if strings.TrimSpace(content) == "" {
			content = "(empty flomo memo)"
		}

		ts := createdAt.Unix()
		data.Memos = append(data.Memos, importExportMemoRecord{
			UID:             memoUID,
			CreatorUsername: username,
			CreatedTs:       ts,
			UpdatedTs:       ts,
			RowStatus:       store.Normal.String(),
			Content:         content,
			Visibility:      store.Private.String(),
		})
	}

	sort.SliceStable(data.Memos, func(i, j int) bool {
		if data.Memos[i].CreatedTs == data.Memos[j].CreatedTs {
			return data.Memos[i].UID < data.Memos[j].UID
		}
		return data.Memos[i].CreatedTs < data.Memos[j].CreatedTs
	})
	return data, nil
}

func zipEntriesByCleanName(zipReader *zip.Reader) map[string]*zip.File {
	entries := make(map[string]*zip.File, len(zipReader.File))
	for _, file := range zipReader.File {
		name := cleanZipEntryName(file.Name)
		if name != "" {
			entries[name] = file
		}
	}
	return entries
}

func cleanZipEntryName(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = strings.TrimPrefix(path.Clean(name), "./")
	if name == "." || strings.HasPrefix(name, "../") || name == ".." {
		return ""
	}
	return name
}

func resolveFlomoZipEntryName(htmlBaseDir, rawSrc string) (string, bool) {
	src := strings.TrimSpace(rawSrc)
	if src == "" {
		return "", false
	}
	parsed, err := url.Parse(src)
	if err == nil && (parsed.IsAbs() || parsed.Host != "") {
		return "", false
	}
	if err == nil && parsed.Path != "" {
		src = parsed.Path
	}
	if decoded, err := url.PathUnescape(src); err == nil {
		src = decoded
	}
	src = strings.ReplaceAll(src, "\\", "/")
	if strings.HasPrefix(src, "/") {
		return "", false
	}
	cleanSrc := cleanZipEntryName(src)
	if cleanSrc == "" {
		return "", false
	}
	cleaned := cleanZipEntryName(path.Join(htmlBaseDir, cleanSrc))
	if cleaned == "" || strings.HasPrefix(cleaned, "../") || cleaned == ".." {
		return "", false
	}
	return cleaned, true
}

func renderFlomoContent(node *html.Node) string {
	if node == nil {
		return ""
	}
	blocks := []string{}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		rendered := renderFlomoBlock(child, 0)
		if strings.TrimSpace(rendered) != "" {
			blocks = append(blocks, strings.TrimSpace(rendered))
		}
	}
	return strings.TrimSpace(strings.Join(blocks, "\n\n"))
}

func renderFlomoBlock(node *html.Node, depth int) string {
	if node.Type == html.TextNode {
		return normalizeInlineWhitespace(node.Data)
	}
	if node.Type != html.ElementNode {
		return renderFlomoChildren(node, depth)
	}

	switch strings.ToLower(node.Data) {
	case "p", "div":
		return strings.TrimSpace(renderFlomoChildren(node, depth))
	case "br":
		return "\n"
	case "ul", "ol":
		return renderFlomoList(node, depth, strings.ToLower(node.Data) == "ol")
	case "blockquote":
		text := strings.TrimSpace(renderFlomoChildren(node, depth))
		if text == "" {
			return ""
		}
		lines := strings.Split(text, "\n")
		for i, line := range lines {
			lines[i] = "> " + line
		}
		return strings.Join(lines, "\n")
	default:
		return renderFlomoInline(node)
	}
}

func renderFlomoChildren(node *html.Node, depth int) string {
	parts := []string{}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		parts = append(parts, renderFlomoBlock(child, depth))
	}
	return strings.TrimSpace(joinInlineParts(parts))
}

func renderFlomoList(node *html.Node, depth int, ordered bool) string {
	lines := []string{}
	index := 1
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if child.Type != html.ElementNode || strings.ToLower(child.Data) != "li" {
			continue
		}
		text := strings.TrimSpace(renderFlomoChildren(child, depth+1))
		if text == "" {
			continue
		}
		prefix := "- "
		if ordered {
			prefix = fmt.Sprintf("%d. ", index)
		}
		indent := strings.Repeat("  ", depth)
		lines = append(lines, indent+prefix+strings.ReplaceAll(text, "\n", "\n"+indent+"  "))
		index++
	}
	return strings.Join(lines, "\n")
}

func renderFlomoInline(node *html.Node) string {
	if node == nil {
		return ""
	}
	if node.Type == html.TextNode {
		return normalizeInlineWhitespace(node.Data)
	}
	if node.Type != html.ElementNode {
		return renderFlomoChildren(node, 0)
	}

	text := strings.TrimSpace(renderFlomoChildren(node, 0))
	switch strings.ToLower(node.Data) {
	case "br":
		return "\n"
	case "strong", "b":
		if text == "" {
			return ""
		}
		return "**" + text + "**"
	case "em", "i":
		if text == "" {
			return ""
		}
		return "*" + text + "*"
	case "code":
		if text == "" {
			return ""
		}
		return "`" + strings.ReplaceAll(text, "`", "'") + "`"
	case "a":
		href := strings.TrimSpace(nodeAttr(node, "href"))
		if href == "" {
			return text
		}
		if text == "" {
			text = href
		}
		return "[" + escapeMarkdownLinkText(text) + "](" + href + ")"
	case "img", "audio":
		return ""
	default:
		return text
	}
}

func joinInlineParts(parts []string) string {
	var builder strings.Builder
	for _, part := range parts {
		if part == "" {
			continue
		}
		if builder.Len() == 0 {
			builder.WriteString(part)
			continue
		}
		prev := lastRune(builder.String())
		next := firstRune(part)
		if prev == '\n' || next == '\n' || unicode.IsSpace(prev) || unicode.IsSpace(next) || isCJK(prev) || isCJK(next) {
			builder.WriteString(part)
		} else {
			builder.WriteByte(' ')
			builder.WriteString(part)
		}
	}
	return builder.String()
}

func collectFlomoMediaReferences(node *html.Node) []flomoMediaReference {
	refs := []flomoMediaReference{}
	walkHTML(node, func(candidate *html.Node) {
		if candidate.Type != html.ElementNode {
			return
		}
		switch strings.ToLower(candidate.Data) {
		case "img":
			if src := nodeAttr(candidate, "src"); src != "" {
				refs = append(refs, flomoMediaReference{Kind: "image", Src: src})
			}
		case "audio":
			if src := nodeAttr(candidate, "src"); src != "" {
				transcript := ""
				if candidate.Parent != nil {
					transcript = strings.TrimSpace(nodeText(firstNodeByClass(candidate.Parent, "audio-player__content")))
				}
				refs = append(refs, flomoMediaReference{Kind: "audio", Src: src, Transcript: transcript})
			}
		}
	})
	return refs
}

func appendFlomoAttachmentMarkdown(content string, media flomoMediaReference, attachmentUID, filename string) string {
	var extra string
	switch media.Kind {
	case "image":
		extra = fmt.Sprintf("![%s](/file/attachments/%s/%s)", escapeMarkdownLinkText(filename), attachmentUID, url.PathEscape(filename))
	case "audio":
		lines := []string{}
		if strings.TrimSpace(media.Transcript) != "" {
			lines = append(lines, strings.TrimSpace(media.Transcript))
		}
		lines = append(lines, fmt.Sprintf("[%s](/file/attachments/%s/%s)", escapeMarkdownLinkText(filename), attachmentUID, url.PathEscape(filename)))
		extra = strings.Join(lines, "\n\n")
	default:
		return content
	}
	if strings.TrimSpace(content) == "" {
		return extra
	}
	return strings.TrimSpace(content) + "\n\n" + extra
}

func firstNodeByClass(node *html.Node, className string) *html.Node {
	if node == nil {
		return nil
	}
	var result *html.Node
	walkHTML(node, func(candidate *html.Node) {
		if result != nil || candidate.Type != html.ElementNode {
			return
		}
		if nodeHasClass(candidate, className) {
			result = candidate
		}
	})
	return result
}

func findAllNodesByClass(node *html.Node, className string) []*html.Node {
	nodes := []*html.Node{}
	walkHTML(node, func(candidate *html.Node) {
		if candidate.Type == html.ElementNode && nodeHasClass(candidate, className) {
			nodes = append(nodes, candidate)
		}
	})
	return nodes
}

func walkHTML(node *html.Node, visit func(*html.Node)) {
	if node == nil {
		return
	}
	visit(node)
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		walkHTML(child, visit)
	}
}

func nodeHasClass(node *html.Node, className string) bool {
	for _, class := range strings.Fields(nodeAttr(node, "class")) {
		if class == className {
			return true
		}
	}
	return false
}

func nodeAttr(node *html.Node, name string) string {
	if node == nil {
		return ""
	}
	for _, attr := range node.Attr {
		if strings.EqualFold(attr.Key, name) {
			return attr.Val
		}
	}
	return ""
}

func nodeText(node *html.Node) string {
	if node == nil {
		return ""
	}
	if node.Type == html.TextNode {
		return node.Data
	}
	parts := []string{}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		parts = append(parts, nodeText(child))
	}
	return joinInlineParts(parts)
}

func stableImportUID(prefix string, parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = io.WriteString(hash, part)
		_, _ = hash.Write([]byte{0})
	}
	return prefix + "-" + hex.EncodeToString(hash.Sum(nil))[:24]
}

func hexSha256(blob []byte) string {
	sum := sha256.Sum256(blob)
	return hex.EncodeToString(sum[:])
}

func flomoImportLocation() *time.Location {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.Local
	}
	return location
}

func safeImportFilename(filename, kind string, index int) string {
	filename = strings.TrimSpace(filename)
	if validateFilename(filename) {
		return filename
	}
	ext := filepath.Ext(filename)
	if ext == "" {
		if kind == "audio" {
			ext = ".m4a"
		} else {
			ext = ".jpg"
		}
	}
	return fmt.Sprintf("flomo-%s-%d%s", kind, index+1, ext)
}

func mimeTypeByExtension(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".m4a":
		return "audio/mp4"
	case ".mp3":
		return "audio/mpeg"
	default:
		return ""
	}
}

func normalizeInlineWhitespace(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func escapeMarkdownLinkText(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "[", "\\[")
	value = strings.ReplaceAll(value, "]", "\\]")
	return value
}

func firstRune(value string) rune {
	for _, r := range value {
		return r
	}
	return 0
}

func lastRune(value string) rune {
	var last rune
	for _, r := range value {
		last = r
	}
	return last
}

func isCJK(r rune) bool {
	return (r >= 0x4E00 && r <= 0x9FFF) || (r >= 0x3400 && r <= 0x4DBF) || (r >= 0x3040 && r <= 0x30FF)
}
