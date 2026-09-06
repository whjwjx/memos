import { cn } from "@/lib/utils";
import type { ReactMarkdownProps } from "./types";

interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement>, ReactMarkdownProps {
  priority?: boolean;
}

const PRIORITY_IMAGE_FALLBACK_WIDTH = 1600;
const PRIORITY_IMAGE_FALLBACK_HEIGHT = 1000;

/**
 * Image component for markdown images
 * Responsive with rounded corners
 */
export const Image = ({ className, alt, node: _node, height, width, priority, style, ...props }: ImageProps) => {
  const resolvedWidth = priority && !width && !height ? PRIORITY_IMAGE_FALLBACK_WIDTH : width;
  const resolvedHeight = priority && !width && !height ? PRIORITY_IMAGE_FALLBACK_HEIGHT : height;

  return (
    <img
      className={cn("max-w-full h-auto my-2", className)}
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
