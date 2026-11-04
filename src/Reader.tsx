import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./pdf-text.css";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Highlighter,
  Search,
  List,
  Download,
  LoaderCircle,
  MessageSquare,
} from "lucide-react";
import type { Item, Draft } from "../shared/types";
import { toPdfRect, toViewportRect } from "../shared/pdfGeometry";
GlobalWorkerOptions.workerSrc = worker;
type Selection = { quote: string; rects: number[][] };
export default function Reader({
  attachment,
  annotations,
  reading,
  onReading,
  onAnnotate,
  jump,
  onPageChange,
}: {
  attachment: Item;
  annotations: Item[];
  reading?: Draft;
  onReading: (data: Draft) => void;
  onAnnotate: (data: Draft) => Promise<void>;
  jump?: { page: number; stamp: number };
  onPageChange?: (page: number) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState<number>(
    reading?.attachmentId === attachment.id ? Number(reading.page) || 1 : 1,
  );
  const [scale, setScale] = useState<number>(Number(reading?.scale) || 1);
  const [rotation, setRotation] = useState<number>(
    Number(reading?.rotation) || 0,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Selection>();
  const [comment, setComment] = useState("");
  const [outline, setOutline] = useState<{ title: string; page: number }[]>([]);
  const [showOutline, setShowOutline] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [geometry, setGeometry] = useState<{
    width: number;
    height: number;
    rects: { id: string; boxes: number[][]; comment: string }[];
  }>();
  const annotationSignature = JSON.stringify(annotations);
  const canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null),
    viewportRef = useRef<any>(null),
    pageView = useRef<number[]>([]);
  const onReadingRef = useRef(onReading);
  onReadingRef.current = onReading;
  const onAnnotateRef = useRef(onAnnotate);
  onAnnotateRef.current = onAnnotate;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const task = getDocument({
      url: `/api/attachments/${attachment.id}/file`,
      cMapUrl: "/pdf-assets/cmaps/",
      standardFontDataUrl: "/pdf-assets/standard_fonts/",
      wasmUrl: "/pdf-assets/wasm/",
    });
    task.promise
      .then(async (doc) => {
        if (!active) return;
        setPdf(doc);
        const nodes = await doc.getOutline();
        const all: { title: string; page: number }[] = [];
        async function visit(list: any[]) {
          for (const n of list) {
            try {
              const dest =
                typeof n.dest === "string"
                  ? await doc.getDestination(n.dest)
                  : n.dest;
              if (dest) {
                const p =
                  typeof dest[0] === "number"
                    ? dest[0]
                    : await doc.getPageIndex(dest[0]);
                all.push({ title: n.title, page: p + 1 });
              }
            } catch {}
            if (n.items) await visit(n.items);
          }
        }
        await visit(nodes || []);
        if (active) setOutline(all);
      })
      .catch((e) => active && setError("无法打开 PDF：" + e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      void task.destroy();
    };
  }, [attachment.id]);
  useEffect(() => {
    onPageChange?.(page);
  }, [page, onPageChange]);
  useEffect(() => {
    if (jump)
      setPage(Math.max(1, Math.min(attachment.pageCount || 1, jump.page)));
  }, [jump]);
  useEffect(() => {
    if (!pdf) return;
    const timer = setTimeout(
      () =>
        onReadingRef.current({
          attachmentId: attachment.id,
          page,
          scale,
          rotation,
        }),
      450,
    );
    return () => clearTimeout(timer);
  }, [page, scale, rotation, pdf, attachment.id]);
  useEffect(() => {
    if (!pdf || !canvas.current || !text.current) return;
    let cancelled = false;
    let render: any;
    let layer: TextLayer | undefined;
    setSelection(undefined);
    setLoading(true);
    setError("");
    (async () => {
      const p = await pdf.getPage(Math.max(1, Math.min(page, pdf.numPages)));
      if (cancelled) return;
      const viewport = p.getViewport({
        scale,
        rotation: (p.rotate + rotation) % 360,
      });
      viewportRef.current = viewport;
      pageView.current = p.view;
      const target = canvas.current!,
        container = text.current!;
      const ratio = window.devicePixelRatio || 1;
      target.width = Math.floor(viewport.width * ratio);
      target.height = Math.floor(viewport.height * ratio);
      target.style.width = viewport.width + "px";
      target.style.height = viewport.height + "px";
      container.innerHTML = "";
      container.style.setProperty("--scale-factor", String(scale));
      container.style.setProperty("--total-scale-factor", String(scale));
      container.style.width = viewport.width + "px";
      container.style.height = viewport.height + "px";
      const boxes = annotations
        .filter((a) => a.page === page)
        .map((a) => ({
          id: a.id,
          comment: a.comment || a.quote,
          boxes: a.rects.map((r: number[]) => {
            return toViewportRect(r, p.view, viewport);
          }),
        }));
      setGeometry({
        width: viewport.width,
        height: viewport.height,
        rects: boxes,
      });
      render = p.render({
        canvasContext: target.getContext("2d")!,
        canvas: target,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });
      await render.promise;
      if (cancelled) return;
      layer = new TextLayer({
        textContentSource: await p.getTextContent(),
        container,
        viewport,
      });
      await layer.render();
      if (query)
        container.querySelectorAll("span").forEach((s) => {
          if (s.textContent?.toLowerCase().includes(query.toLowerCase()))
            s.classList.add("reader-search-match");
        });
    })()
      .catch((e) => {
        if (
          !cancelled &&
          e.name !== "RenderingCancelledException" &&
          e.name !== "AbortException"
        )
          setError("页面渲染失败：" + e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      render?.cancel();
      layer?.cancel();
    };
  }, [pdf, page, scale, rotation, annotationSignature, query]);
  function capture() {
    const s = window.getSelection();
    if (
      !s ||
      s.isCollapsed ||
      !s.rangeCount ||
      !text.current?.contains(s.anchorNode) ||
      !text.current?.contains(s.focusNode)
    ) {
      return;
    }
    const range = s.getRangeAt(0),
      bounds = surface.current!.getBoundingClientRect(),
      v = pageView.current,
      vp = viewportRef.current;
    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => {
        return toPdfRect(r, bounds, v, vp);
      });
    setSelection({ quote: s.toString(), rects });
  }
  async function annotate() {
    if (!selection) return;
    try {
      await onAnnotateRef.current({
        attachmentId: attachment.id,
        paperId: attachment.paperId,
        page,
        quote: selection.quote,
        rects: selection.rects,
        comment,
        color: "yellow",
      });
      setSelection(undefined);
      setComment("");
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function find() {
    if (!pdf || !query.trim()) return;
    setSearching(true);
    const found: number[] = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const p = await pdf.getPage(i),
          t = await p.getTextContent();
        if (
          t.items
            .map((v: any) => v.str || "")
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase())
        )
          found.push(i);
      }
      setMatches(found);
      setSearchDone(true);
      if (found.length) setPage(found[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }
  return (
    <div className="reader">
      <div className="reader-toolbar">
        <button title="目录" onClick={() => setShowOutline(!showOutline)}>
          <List size={17} />
        </button>
        <span className="reader-file">{attachment.name}</span>
        <a
          className="icon-button"
          href={`/api/attachments/${attachment.id}/file`}
          download={attachment.name}
          title="下载 PDF"
        >
          <Download size={16} />
        </a>
      </div>
      <div className="reader-controls">
        <button
          title="上一页"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <input
          aria-label="页码"
          type="number"
          min={1}
          max={pdf?.numPages || 1}
          value={page}
          onChange={(e) =>
            setPage(
              Math.max(
                1,
                Math.min(pdf?.numPages || 1, Number(e.target.value) || 1),
              ),
            )
          }
        />
        <span>/ {pdf?.numPages || "—"}</span>
        <button
          title="下一页"
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight size={16} />
        </button>
        <span className="toolbar-divider" />
        <button
          title="缩小"
          onClick={() => setScale((s) => Math.max(0.4, +(s - 0.15).toFixed(2)))}
        >
          <ZoomOut size={16} />
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button
          title="放大"
          onClick={() => setScale((s) => Math.min(3, +(s + 0.15).toFixed(2)))}
        >
          <ZoomIn size={16} />
        </button>
        <button title="旋转" onClick={() => setRotation((r) => (r + 90) % 360)}>
          <RotateCw size={16} />
        </button>
      </div>
      <form
        className="reader-search"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <Search size={14} />
        <input
          aria-label="PDF 内搜索"
          placeholder="在本文中查找…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchDone(false);
          }}
        />
        <button disabled={searching}>{searching ? "查找中" : "查找"}</button>
        {searchDone && (
          <span>
            {matches.length
              ? matches.map((p) => (
                  <button type="button" key={p} onClick={() => setPage(p)}>
                    {p}
                  </button>
                ))
              : "未找到"}
          </span>
        )}
      </form>
      {showOutline && (
        <div className="outline">
          {outline.length ? (
            outline.map((n, i) => (
              <button
                key={i}
                onClick={() => {
                  setPage(n.page);
                  setShowOutline(false);
                }}
              >
                {n.title}
                <span>{n.page}</span>
              </button>
            ))
          ) : (
            <p className="muted">此 PDF 没有内置目录</p>
          )}
        </div>
      )}
      {selection && (
        <div className="selection-bar">
          <Highlighter size={16} />
          <span>已选择 {selection.quote.length} 字</span>
          <input
            aria-label="批注内容"
            placeholder="添加批注（可选）"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button className="primary small" onClick={() => void annotate()}>
            保存高亮
          </button>
          <button onClick={() => setSelection(undefined)}>取消</button>
        </div>
      )}
      <div className="pdf-scroll">
        {error && <div className="inline-error">{error}</div>}
        {loading && (
          <div className="reader-loading">
            <LoaderCircle className="spin" size={18} /> 正在载入页面
          </div>
        )}
        <div
          className="pdf-surface"
          ref={surface}
          style={{ width: geometry?.width, height: geometry?.height }}
          onMouseUp={capture}
        >
          <canvas ref={canvas} />
          <div className="highlight-layer">
            {geometry?.rects.flatMap((a) =>
              a.boxes.map((r, i) => (
                <div
                  key={a.id + i}
                  className="pdf-highlight"
                  title={a.comment}
                  style={{ left: r[0], top: r[1], width: r[2], height: r[3] }}
                />
              )),
            )}
          </div>
          <div ref={text} className="textLayer" />
        </div>
        {!error && !loading && (
          <div className="reader-tip">
            <MessageSquare size={13} /> 选择文字即可高亮；右侧笔记可插入页码引用
          </div>
        )}
      </div>
    </div>
  );
}
