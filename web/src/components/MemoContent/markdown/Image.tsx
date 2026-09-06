import { cn } from "@/lib/utils";
import type { MemoMediaSize } from "../types";
import type { ReactMarkdownProps } from "./types";

interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement>, ReactMarkdownProps {
  priority?: boolean;
  mediaSize?: MemoMediaSize;
}

const PRIORITY_IMAGE_FALLBACK_WIDTH = 1600;
const PRIORITY_IMAGE_FALLBACK_HEIGHT = 1000;

/**
 * Image component for markdown images
 * Responsive with rounded corners
 */
export const Image = ({ className, alt, node: _node, height, width, priority, mediaSize = "list", style, ...props }: ImageProps) => {
  const resolvedWidth = priority && !width && !height ? PRIORITY_IMAGE_FALLBACK_WIDTH : width;
  const resolvedHeight = priority && !width && !height ? PRIORITY_IMAGE_FALLBACK_HEIGHT : height;

  return (
    <img
      className={cn(
        "h-auto max-w-full w-auto my-2 rounded-md object-contain",
        mediaSize === "detail" ? "max-h-[32rem]" : "max-h-[18rem] sm:max-w-[32rem]",
        className,
      )}
      alt={alt}
      width={resolvedWidth}
      height={resolvedHeight}
      style={style}
      {...props}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "low"}
    />
  );
};
