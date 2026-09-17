import Markdown from "react-markdown";

export function MarkdownMessage({ children }: { children: string }) {
  return (
    <div className="markdown-message">
      <Markdown skipHtml>{children}</Markdown>
    </div>
  );
}
