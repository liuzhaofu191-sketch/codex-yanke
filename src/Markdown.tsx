import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Item } from "../shared/types";
export default function Markdown({
  body,
  note,
  notes = [],
  onNote,
  onPage,
}: {
  body: string;
  note?: Item;
  notes?: Item[];
  onNote?: (id: string) => void;
  onPage?: (page: number) => void;
}) {
  const content = body
    .replace(
      /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g,
      (_, ref) =>
        `[${ref}](${note?.linkedAttachments?.[ref] ? "/api/attachments/" + note.linkedAttachments[ref] + "/file" : "#missing-attachment"})`,
    )
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_, target, label) =>
        `[${label || target}](#wiki-${encodeURIComponent(target)})`,
    );
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("#page-"))
              return (
                <button
                  className="text-link"
                  onClick={() => onPage?.(Number(href.slice(6)))}
                >
                  {children}
                </button>
              );
            if (href?.startsWith("#wiki-")) {
              const title = decodeURIComponent(href.slice(6));
              const linked = notes.find(
                (n) =>
                  n.title === title ||
                  n.bindings?.some(
                    (b: any) =>
                      b.key === title + ".md" ||
                      b.key?.replace(/\.md$/, "") === title,
                  ),
              );
              return (
                <button
                  className="text-link"
                  title={linked ? "打开关联笔记" : "尚未导入此笔记"}
                  onClick={() => linked && onNote?.(linked.id)}
                >
                  {children}
                  {!linked ? " ↗" : ""}
                </button>
              );
            }
            const attachment = href && note?.linkedAttachments?.[href];
            return (
              <a
                href={attachment ? `/api/attachments/${attachment}/file` : href}
                target="_blank"
                rel="noreferrer"
              >
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => {
            const id = src && note?.linkedAttachments?.[src];
            return id ? (
              <img src={`/api/attachments/${id}/file`} alt={alt} />
            ) : (
              <span className="muted">[图片：{alt || src}]</span>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
