import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { CodeBlock } from "@/components/MemoContent/CodeBlock";
import { buildRehypePlugins, buildRemarkPlugins } from "@/components/MemoContent/pipeline";

// Minimal, chat-friendly Markdown renderer. Reuses the same remark/rehype pipeline
// as memos so formatting (GFM, code highlighting) stays consistent, but without the
// memo-specific mention/tag widgets.
const markdownComponents: Components = {
  code: ({ className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className ?? "");
    if (match) {
      return (
        <CodeBlock className={className} {...props}>
          {children}
        </CodeBlock>
      );
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded border border-border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-border bg-muted/40 px-3 py-1.5 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b border-border px-3 py-1.5">{children}</td>,
};

interface ChatMarkdownProps {
  content: string;
}

export const ChatMarkdown = memo(({ content }: ChatMarkdownProps) => {
  return (
    <div className="space-y-2 break-words leading-relaxed [&_li]:my-0.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_p]:my-1">
      <ReactMarkdown remarkPlugins={buildRemarkPlugins()} rehypePlugins={buildRehypePlugins()} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default ChatMarkdown;
