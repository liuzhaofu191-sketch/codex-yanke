import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  FileText,
  FlaskConical,
  Folder,
  FolderPlus,
  GraduationCap,
  Highlighter,
  Home,
  LayoutGrid,
  Library,
  Link2,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  NotebookPen,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
  ExternalLink,
  CalendarDays,
  Pencil,
  Download,
  Archive,
  Layers,
} from "lucide-react";
import { api, write, download, type State } from "./api";
import {
  type Item,
  type Kind,
  type Draft,
  type SearchHit,
  normalizeDoi,
} from "../shared/types";
import Reader from "./Reader";
import Markdown from "./Markdown";

const navigation = [
  { id: "home", label: "工作台", icon: Home },
  { id: "papers", label: "文献库", icon: Library },
  { id: "notes", label: "知识笔记", icon: NotebookPen },
  { id: "tools", label: "科研工具", icon: LayoutGrid },
  { id: "projects", label: "项目任务", icon: Folder },
  { id: "settings", label: "设置与数据", icon: Settings2 },
];
const statusText: Record<string, string> = {
  unread: "待读",
  reading: "阅读中",
  done: "已完成",
  todo: "待办",
  doing: "进行中",
};
const emptyState = () =>
  Object.fromEntries(
    [
      "papers",
      "attachments",
      "notes",
      "annotations",
      "sources",
      "tools",
      "projects",
      "tasks",
      "experiments",
      "settings",
      "imports",
    ].map((k) => [k, []]),
  ) as unknown as State;
type Modal = { kind: Kind; item?: Item; defaults?: Draft };
function date(value?: string) {
  return value
    ? new Date(value).toLocaleDateString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
      })
    : "未设置";
}
function initials(title: string) {
  return (title || "研").slice(0, 1).toUpperCase();
}
function Empty({
  icon = <BookOpen size={30} />,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
function Badge({
  children,
  color = "gray",
}: {
  children: ReactNode;
  color?: string;
}) {
  return <span className={`badge ${color}`}>{children}</span>;
}

export default function App() {
  const [data, setData] = useState<State>(emptyState),
    [ready, setReady] = useState(false),
    [initialError, setInitialError] = useState("");
  const [page, setPage] = useState("home"),
    [collapsed, setCollapsed] = useState(false),
    [modal, setModal] = useState<Modal>(),
    [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [selectedPaper, setSelectedPaper] = useState<string>(),
    [selectedNote, setSelectedNote] = useState<string>(),
    [selectedProject, setSelectedProject] = useState<string>(),
    [selectedExperiment, setSelectedExperiment] = useState<string>();
  const [query, setQuery] = useState(""),
    [hits, setHits] = useState<SearchHit[]>([]),
    [showSearch, setShowSearch] = useState(false),
    [searchBusy, setSearchBusy] = useState(false);
  const [paperQuery, setPaperQuery] = useState(""),
    [paperFilter, setPaperFilter] = useState("all"),
    [toolQuery, setToolQuery] = useState(""),
    [toolCategory, setToolCategory] = useState("全部工具"),
    [noteQuery, setNoteQuery] = useState("");
  const [currentPdfPage, setCurrentPdfPage] = useState(1);
  const [jump, setJump] = useState<{ page: number; stamp: number }>(),
    [selectedAttachment, setSelectedAttachment] = useState<string>(),
    [utility, setUtility] = useState<string>(),
    [utilityText, setUtilityText] = useState(""),
    [utilityOutput, setUtilityOutput] = useState("");
  const [busy, setBusy] = useState(false),
    [importTarget, setImportTarget] = useState<string>();
  const importRef = useRef<HTMLInputElement>(null),
    restoreRef = useRef<HTMLInputElement>(null),
    toolsImportRef = useRef<HTMLInputElement>(null),
    experimentRef = useRef<HTMLInputElement>(null);
  const notify = (text: string, error = false) => setNotice({ text, error });
  async function refresh() {
    const s = await api<State>("/state");
    setData(s);
    setReady(true);
    setInitialError("");
    return s;
  }
  useEffect(() => {
    refresh().catch((e) => setInitialError(e.message));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const activeImports = data.imports.some((r) => r.status === "running");
  useEffect(() => {
    if (!activeImports) return;
    const timer = setInterval(
      () => refresh().catch((e) => notify(e.message, true)),
      1200,
    );
    return () => clearInterval(timer);
  }, [activeImports]);
  async function action(fn: () => Promise<any>, message?: string) {
    try {
      setBusy(true);
      const value = await fn();
      await refresh();
      if (message) notify(message);
      return value;
    } catch (e) {
      notify((e as Error).message, true);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  async function saveBody(
    kind: "notes" | "experiments",
    id: string,
    body: string,
  ) {
    const updated = await write(kind, { body }, id);
    setData((prev) => ({
      ...prev,
      [kind]: prev[kind].map((item) => (item.id === id ? updated : item)),
    }));
  }
  function openPaper(id: string, pageNumber?: number, attachmentId?: string) {
    setSelectedPaper(id);
    setSelectedAttachment(attachmentId);
    setPage("papers");
    setJump(pageNumber ? { page: pageNumber, stamp: Date.now() } : undefined);
  }
  function openNote(id: string) {
    setSelectedNote(id);
    setPage("notes");
  }
  function startImport(paperId?: string) {
    setImportTarget(paperId);
    if (importRef.current) {
      importRef.current.value = "";
      importRef.current.click();
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const form = new FormData();
    if (importTarget) form.append("paperId", importTarget);
    for (const f of files) form.append("files", f);
    await action(
      () => api("/import", { method: "POST", body: form }),
      "导入已开始，可在设置页查看逐项结果",
    );
  }
  async function remove(item: Item) {
    if (
      !confirm(
        `删除“${item.title || item.name || "此记录"}”？${item.kind === "papers" ? "论文附件和批注的工作台记录也会删除，独立笔记保留。" : ""}`,
      )
    )
      return;
    await action(
      () => api(`/records/${item.kind}/${item.id}`, { method: "DELETE" }),
      "已删除",
    );
  }
  async function search(value: string) {
    setQuery(value);
    setShowSearch(true);
    if (!value.trim()) {
      setHits([]);
      return;
    }
    setSearchBusy(true);
    try {
      const results = await api<SearchHit[]>(
        "/search?q=" + encodeURIComponent(value),
      );
      setHits(results);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setSearchBusy(false);
    }
  }
  function visitHit(hit: SearchHit) {
    setShowSearch(false);
    if (hit.kind === "notes") openNote(hit.id);
    else if (hit.paperId) openPaper(hit.paperId, hit.page, hit.attachmentId);
    else if (hit.kind === "pdf" && hit.attachmentId) {
      window.open(
        `/api/attachments/${hit.attachmentId}/file#page=${hit.page || 1}`,
        "_blank",
        "noopener,noreferrer",
      );
    } else if (hit.kind === "tools") {
      setPage("tools");
      setToolQuery(hit.title);
    } else if (hit.kind === "projects") {
      setPage("projects");
      setSelectedProject(hit.id);
    } else if (hit.kind === "tasks") {
      setPage("projects");
      setSelectedProject(data.tasks.find((t) => t.id === hit.id)?.projectId);
    } else if (hit.kind === "experiments") {
      setPage("projects");
      const e = data.experiments.find((e) => e.id === hit.id);
      setSelectedProject(e?.projectId);
      setSelectedExperiment(hit.id);
    }
  }
  const paper = data.papers.find((p) => p.id === selectedPaper),
    note = data.notes.find((n) => n.id === selectedNote) || data.notes[0],
    project = data.projects.find((p) => p.id === selectedProject),
    experiment = data.experiments.find(
      (e) =>
        e.id === selectedExperiment && (!project || e.projectId === project.id),
    );
  const paperAttachments = data.attachments.filter(
      (a) => a.paperId === paper?.id,
    ),
    attachment =
      paperAttachments.find((a) => a.id === selectedAttachment) ||
      paperAttachments.find((a) => a.id === paper?.reading?.attachmentId) ||
      paperAttachments[0];
  const paperAnnotations = data.annotations.filter(
      (a) => a.paperId === paper?.id,
    ),
    paperNotes = data.notes.filter((n) => n.paperId === paper?.id);
  const filteredPapers = data.papers
    .filter(
      (p) =>
        (paperFilter === "all" || p.status === paperFilter) &&
        (p.title + " " + p.authors + " " + p.doi + " " + p.tags?.join(" "))
          .toLowerCase()
          .includes(paperQuery.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const selectedNav = navigation.find((n) => n.id === page)!;
  const today = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  const toolbar = (
    <>
      <button className="secondary" onClick={() => startImport()}>
        <Upload size={16} />
        导入资料
      </button>
      <button
        className="primary"
        onClick={() =>
          setModal({ kind: "papers", defaults: { status: "unread", tags: [] } })
        }
      >
        <Plus size={17} />
        添加文献
      </button>
    </>
  );

  return (
    <div className={`app ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("home");
          }}
        >
          <span className="brand-symbol">
            <Layers size={24} />
          </span>
          {!collapsed && (
            <span>
              研序<small>RESEARCH DESK</small>
            </span>
          )}
        </a>
        {!collapsed && (
          <div className="workspace-switch">
            <span className="workspace-avatar">研</span>
            <span>
              个人科研空间
              <small>
                <i />
                本地工作区
              </small>
            </span>
            <ChevronDown size={14} />
          </div>
        )}
        {!collapsed && <div className="nav-label">工作空间</div>}
        <nav>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              title={label}
              onClick={() => {
                setPage(id);
                setShowSearch(false);
              }}
            >
              <Icon size={19} />
              {!collapsed && (
                <>
                  <span>{label}</span>
                  {id === "papers" && data.papers.length > 0 && (
                    <em>{data.papers.length}</em>
                  )}
                </>
              )}
            </button>
          ))}
        </nav>
        {!collapsed && (
          <>
            <div className="nav-label project-label">
              我的课题
              <button
                title="新建课题"
                onClick={() =>
                  setModal({ kind: "projects", defaults: { status: "doing" } })
                }
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="sidebar-projects">
              {data.projects.slice(0, 5).map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setPage("projects");
                    setSelectedProject(p.id);
                  }}
                >
                  <i
                    style={{
                      background: ["#9d91d7", "#72afa0", "#e5b66c", "#84a8d6"][
                        i % 4
                      ],
                    }}
                  />
                  {p.title}
                </button>
              ))}
              {!data.projects.length && (
                <button
                  className="muted"
                  onClick={() =>
                    setModal({
                      kind: "projects",
                      defaults: { status: "doing" },
                    })
                  }
                >
                  创建你的第一个课题
                </button>
              )}
            </div>
            <div className="sidebar-tip">
              <FlaskConical size={21} />
              <strong>让每一次探索，有迹可循。</strong>
              <p>连接文献、想法与下一步行动。</p>
            </div>
          </>
        )}
        <div className="sidebar-bottom">
          <button
            className="collapse-button"
            title={collapsed ? "展开导航" : "收起导航"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <Menu size={19} /> : <PanelLeftClose size={18} />}
          </button>
          {!collapsed && (
            <>
              <span className="profile-avatar">我</span>
              <div>
                我的研究空间<small>资料保存在本机</small>
              </div>
            </>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间
            <ChevronRight size={13} />
            <strong>{selectedNav.label}</strong>
          </div>
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              void search(query);
            }}
          >
            <Search size={16} />
            <input
              aria-label="全局搜索"
              placeholder="搜索文献、笔记、批注…"
              value={query}
              onFocus={() => query && setShowSearch(true)}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>Enter</kbd>
          </form>
          <span className="local-status">
            <i />
            本地已连接
          </span>
          <button
            className="profile-button"
            onClick={() => setPage("settings")}
            title="设置与数据"
          >
            研
          </button>
        </header>
        {showSearch && (
          <div className="search-panel">
            <div className="section-heading">
              <h3>
                搜索结果 <span>{hits.length}</span>
              </h3>
              <button title="关闭搜索" onClick={() => setShowSearch(false)}>
                <X size={18} />
              </button>
            </div>
            <form
              className="external-search"
              onSubmit={(e) => {
                e.preventDefault();
                void search(query);
              }}
            >
              <input
                aria-label="搜索关键词"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="primary small">检索本地资料</button>
            </form>
            <div className="external-links">
              继续搜索：
              {data.settings[0]?.searchEngines?.map((engine: any) => (
                <a
                  key={engine.name}
                  href={engine.url.replace(
                    "{query}",
                    encodeURIComponent(query),
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  {engine.name}
                  <ArrowUpRight size={12} />
                </a>
              ))}
            </div>
            {searchBusy ? (
              <div className="empty">
                <LoaderCircle className="spin" />
              </div>
            ) : hits.length ? (
              <div className="search-results">
                {hits.map((hit) => (
                  <button key={hit.id} onClick={() => visitHit(hit)}>
                    <span className="search-kind">
                      {{
                        papers: "文献",
                        pdf: "PDF 正文",
                        notes: "笔记",
                        annotations: "批注",
                        projects: "课题",
                        tools: "工具",
                        tasks: "任务",
                        experiments: "实验记录",
                      }[hit.kind] || hit.kind}
                      {hit.page ? " · p." + hit.page : ""}
                    </span>
                    <strong>{hit.title}</strong>
                    <p>{hit.text}</p>
                  </button>
                ))}
              </div>
            ) : (
              <Empty
                title="没有找到匹配的资料"
                description="试试标题、DOI、正文中的词语，或前往外部学术网站。"
              />
            )}
          </div>
        )}
        {initialError ? (
          <div className="page-content">
            <Empty
              title="未能连接本地服务"
              description={initialError}
              action={
                <button
                  className="primary"
                  onClick={() =>
                    refresh().catch((e) => setInitialError(e.message))
                  }
                >
                  重新连接
                </button>
              }
            />
          </div>
        ) : !ready ? (
          <div className="loading-screen">
            <LoaderCircle className="spin" />
            正在打开工作空间…
          </div>
        ) : (
          <main
            className={`page-content ${page === "papers" && paper ? "reading-layout" : ""}`}
          >
            {page === "home" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">YOUR RESEARCH, IN ORDER</div>
                    <h1>
                      今天，也向未知迈进一步
                      <span className="heading-dot">.</span>
                    </h1>
                    <p>
                      {today} <span className="dot-separator">·</span>{" "}
                      欢迎回到你的科研工作台
                    </p>
                  </div>
                  <div className="actions">{toolbar}</div>
                </div>
                <div className="welcome-banner">
                  <div>
                    <Badge color="purple">
                      <Sparkles size={12} />
                      专注你的下一次发现
                    </Badge>
                    <h2>把零散的资料，连接成清晰的研究。</h2>
                    <p>从一篇论文、一个想法，到一个值得探索的课题。</p>
                    <button
                      onClick={() => {
                        setPage("papers");
                        if (!data.papers.length) startImport();
                      }}
                    >
                      继续我的研究
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  <div className="banner-art" aria-hidden="true">
                    <div className="orbit orbit-one" />
                    <div className="orbit orbit-two" />
                    <div className="orbit orbit-three" />
                    <div className="art-book">
                      <BookOpen size={48} />
                    </div>
                    <span className="art-spark">✦</span>
                    <div className="art-note">
                      <Check size={16} />
                      <i />
                      <i />
                      <i />
                    </div>
                    <span className="art-dot" />
                  </div>
                </div>
                <div className="stats-grid">
                  {[
                    {
                      label: "我的文献",
                      value: data.papers.length,
                      sub: `${data.papers.filter((p) => p.status === "reading").length} 篇正在阅读`,
                      icon: BookOpen,
                      color: "purple",
                      target: "papers",
                    },
                    {
                      label: "知识笔记",
                      value: data.notes.length,
                      sub: "记录想法，积累知识",
                      icon: NotebookPen,
                      color: "blue",
                      target: "notes",
                    },
                    {
                      label: "进行中课题",
                      value: data.projects.filter((p) => p.status !== "done")
                        .length,
                      sub: `${data.projects.length} 个课题已收录`,
                      icon: FlaskConical,
                      color: "green",
                      target: "projects",
                    },
                    {
                      label: "待完成任务",
                      value: data.tasks.filter((t) => t.status !== "done")
                        .length,
                      sub: `${data.tasks.filter((t) => t.status === "done").length} 项已完成`,
                      icon: CheckCircle2,
                      color: "orange",
                      target: "projects",
                    },
                  ].map((s) => (
                    <button
                      className="stat-card"
                      key={s.label}
                      onClick={() => setPage(s.target)}
                    >
                      <div>
                        <span>{s.label}</span>
                        <strong>
                          {s.value}
                          <small>
                            {s.label === "我的文献"
                              ? "篇"
                              : s.label === "知识笔记"
                                ? "则"
                                : "项"}
                          </small>
                        </strong>
                        <p>{s.sub}</p>
                      </div>
                      <span className={`stat-icon ${s.color}`}>
                        <s.icon size={22} />
                      </span>
                    </button>
                  ))}
                </div>
                <div className="dashboard-columns">
                  <div className="dashboard-primary">
                    <section className="panel">
                      <div className="section-heading">
                        <h2>
                          <Clock3 size={18} />
                          最近阅读
                        </h2>
                        <button
                          className="text-link"
                          onClick={() => setPage("papers")}
                        >
                          全部文献
                          <ArrowRight size={14} />
                        </button>
                      </div>
                      {data.papers.length ? (
                        <div className="recent-papers">
                          {[...data.papers]
                            .sort((a, b) =>
                              (b.lastReadAt || b.updatedAt).localeCompare(
                                a.lastReadAt || a.updatedAt,
                              ),
                            )
                            .slice(0, 4)
                            .map((p) => (
                              <button
                                className="recent-paper"
                                key={p.id}
                                onClick={() => openPaper(p.id)}
                              >
                                <span className="paper-file-icon">
                                  <FileText size={23} />
                                  <small>PDF</small>
                                </span>
                                <div>
                                  <strong>{p.title}</strong>
                                  <p>
                                    {p.authors || "作者待补充"}
                                    <span> · </span>
                                    {p.year || "年份待补充"}
                                  </p>
                                  <div className="paper-tags">
                                    <Badge
                                      color={
                                        p.status === "done"
                                          ? "green"
                                          : p.status === "reading"
                                            ? "purple"
                                            : "gray"
                                      }
                                    >
                                      {statusText[p.status] || "待读"}
                                    </Badge>
                                    {p.tags?.slice(0, 2).map((t: string) => (
                                      <span key={t}>#{t}</span>
                                    ))}
                                  </div>
                                </div>
                                <ChevronRight size={17} />
                              </button>
                            ))}
                        </div>
                      ) : (
                        <Empty
                          title="从第一篇论文开始"
                          description="导入 PDF 或文献库，开启有序的阅读与思考。"
                          action={
                            <button
                              className="secondary small"
                              onClick={() => startImport()}
                            >
                              <Upload size={14} />
                              导入文献
                            </button>
                          }
                        />
                      )}
                    </section>
                    <section className="panel">
                      <div className="section-heading">
                        <h2>
                          <Folder size={18} />
                          进行中的课题
                        </h2>
                        <button
                          className="text-link"
                          onClick={() =>
                            setModal({
                              kind: "projects",
                              defaults: { status: "doing" },
                            })
                          }
                        >
                          <Plus size={14} />
                          新建课题
                        </button>
                      </div>
                      {data.projects.length ? (
                        <div className="project-summary-grid">
                          {data.projects
                            .filter((p) => p.status !== "done")
                            .slice(0, 4)
                            .map((p, i) => {
                              const tasks = data.tasks.filter(
                                  (t) => t.projectId === p.id,
                                ),
                                done = tasks.filter(
                                  (t) => t.status === "done",
                                ).length;
                              return (
                                <button
                                  className="project-summary"
                                  key={p.id}
                                  onClick={() => {
                                    setPage("projects");
                                    setSelectedProject(p.id);
                                  }}
                                >
                                  <div>
                                    <span
                                      className={`mini-folder tone-${i % 3}`}
                                    >
                                      <Folder size={19} />
                                    </span>
                                    <Badge color="green">进行中</Badge>
                                  </div>
                                  <h3>{p.title}</h3>
                                  <p>
                                    {p.description || "持续探索，逐步推进。"}
                                  </p>
                                  <div className="progress-track">
                                    <i
                                      style={{
                                        width:
                                          (tasks.length
                                            ? (done / tasks.length) * 100
                                            : 0) + "%",
                                      }}
                                    />
                                  </div>
                                  <footer>
                                    <span>
                                      {done} / {tasks.length} 项任务
                                    </span>
                                    <span>
                                      {
                                        data.notes.filter(
                                          (n) => n.projectId === p.id,
                                        ).length
                                      }{" "}
                                      则笔记
                                    </span>
                                  </footer>
                                </button>
                              );
                            })}
                        </div>
                      ) : (
                        <Empty
                          icon={<FolderPlus size={28} />}
                          title="让研究围绕课题展开"
                          description="把论文、笔记和下一步任务放在一起。"
                          action={
                            <button
                              className="secondary small"
                              onClick={() =>
                                setModal({
                                  kind: "projects",
                                  defaults: { status: "doing" },
                                })
                              }
                            >
                              创建课题
                            </button>
                          }
                        />
                      )}
                    </section>
                  </div>
                  <div className="dashboard-secondary">
                    <section className="panel">
                      <div className="section-heading">
                        <h2>
                          <CalendarDays size={17} />
                          近期任务
                        </h2>
                        <button
                          title="添加任务"
                          onClick={() =>
                            setModal({
                              kind: "tasks",
                              defaults: { status: "todo", priority: "normal" },
                            })
                          }
                        >
                          <Plus size={17} />
                        </button>
                      </div>
                      {data.tasks.filter((t) => t.status !== "done").length ? (
                        <div className="task-list">
                          {data.tasks
                            .filter((t) => t.status !== "done")
                            .sort((a, b) =>
                              (a.dueDate || "9999").localeCompare(
                                b.dueDate || "9999",
                              ),
                            )
                            .slice(0, 5)
                            .map((t) => (
                              <div className="task-line" key={t.id}>
                                <button
                                  className="task-checkbox"
                                  title="标记完成"
                                  onClick={() =>
                                    void action(() =>
                                      write("tasks", { status: "done" }, t.id),
                                    )
                                  }
                                />
                                <div>
                                  <strong>{t.title}</strong>
                                  <p>
                                    {data.projects.find(
                                      (p) => p.id === t.projectId,
                                    )?.title || "独立任务"}
                                    <span>
                                      {t.dueDate
                                        ? date(t.dueDate)
                                        : "无截止日期"}
                                    </span>
                                  </p>
                                </div>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <div className="quiet-empty">
                          <CheckCircle2 size={26} />
                          <p>暂时没有待办任务</p>
                          <small>给下一个研究目标，留一个位置。</small>
                        </div>
                      )}
                      <button
                        className="dashed-button"
                        onClick={() =>
                          setModal({
                            kind: "tasks",
                            defaults: { status: "todo", priority: "normal" },
                          })
                        }
                      >
                        <Plus size={14} />
                        添加任务
                      </button>
                    </section>
                    <section className="panel">
                      <div className="section-heading">
                        <h2>
                          <Star size={17} />
                          常用工具
                        </h2>
                        <button
                          title="全部工具"
                          onClick={() => setPage("tools")}
                        >
                          <ArrowUpRight size={16} />
                        </button>
                      </div>
                      {data.tools.filter((t) => t.favorite).length ? (
                        <div className="favorite-tools">
                          {data.tools
                            .filter((t) => t.favorite)
                            .sort((a, b) => (a.order || 0) - (b.order || 0))
                            .slice(0, 6)
                            .map((t) => (
                              <a
                                key={t.id}
                                href={t.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <span className="tool-letter">
                                  {initials(t.title)}
                                </span>
                                <span>
                                  {t.title}
                                  <small>{t.category || "其他工具"}</small>
                                </span>
                                <ArrowUpRight size={13} />
                              </a>
                            ))}
                        </div>
                      ) : (
                        <div className="quiet-empty">
                          <LayoutGrid size={26} />
                          <p>你的科研工具，触手可及</p>
                          <small>收藏常用网站，会显示在这里。</small>
                        </div>
                      )}
                      <button
                        className="dashed-button"
                        onClick={() => {
                          setPage("tools");
                          setModal({
                            kind: "tools",
                            defaults: {
                              favorite: true,
                              category: "文献检索",
                              tags: [],
                              order: 0,
                            },
                          });
                        }}
                      >
                        <Plus size={14} />
                        添加工具
                      </button>
                    </section>
                    <div className="local-card">
                      <Database size={19} />
                      <div>
                        <strong>每一份积累，都留在本地</strong>
                        <p>无需账号 · 支持完整备份</p>
                        <button onClick={() => setPage("settings")}>
                          管理我的数据
                          <ArrowRight size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {page === "papers" && (
              <>
                <div className="page-heading compact">
                  <div>
                    <div className="eyebrow">LITERATURE LIBRARY</div>
                    <h1>{paper ? "阅读与思考" : "我的文献库"}</h1>
                    <p>
                      {paper
                        ? "读懂一篇论文，连接一个新的想法。"
                        : `已收录 ${data.papers.length} 篇文献，构建你的研究脉络。`}
                    </p>
                  </div>
                  <div className="actions">
                    {paper && (
                      <button
                        className="secondary"
                        onClick={() => setSelectedPaper(undefined)}
                      >
                        返回文献库
                      </button>
                    )}
                    {toolbar}
                  </div>
                </div>
                {!paper ? (
                  <>
                    <div className="filter-bar">
                      <div className="tabs">
                        {[
                          ["all", "全部文献"],
                          ["unread", "待读"],
                          ["reading", "阅读中"],
                          ["done", "已读完"],
                        ].map(([id, label]) => (
                          <button
                            className={paperFilter === id ? "active" : ""}
                            key={id}
                            onClick={() => setPaperFilter(id)}
                          >
                            {label}
                            <span>
                              {id === "all"
                                ? data.papers.length
                                : data.papers.filter((p) => p.status === id)
                                    .length}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="input-search">
                        <Search size={16} />
                        <input
                          aria-label="筛选文献"
                          placeholder="标题、作者、DOI 或标签"
                          value={paperQuery}
                          onChange={(e) => setPaperQuery(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="panel paper-table">
                      {filteredPapers.length ? (
                        <>
                          <div className="table-head">
                            <span>文献信息</span>
                            <span>阅读状态</span>
                            <span>添加时间</span>
                            <span>操作</span>
                          </div>
                          {filteredPapers.map((p) => (
                            <div className="paper-row" key={p.id}>
                              <button
                                className="paper-title-cell"
                                onClick={() => openPaper(p.id)}
                              >
                                <span className="paper-file-icon">
                                  <FileText size={23} />
                                </span>
                                <div>
                                  <strong>{p.title}</strong>
                                  <p>
                                    {p.authors || "作者待补充"} ·{" "}
                                    {p.year || "—"} ·{" "}
                                    {p.journal || "来源待补充"}
                                  </p>
                                  <div className="paper-tags">
                                    {p.tags?.map((t: string) => (
                                      <span key={t}>#{t}</span>
                                    ))}
                                    {p.bindings?.some(
                                      (b: any) => b.missing,
                                    ) && <Badge color="orange">来源缺失</Badge>}
                                  </div>
                                </div>
                              </button>
                              <span>
                                <Badge
                                  color={
                                    p.status === "reading"
                                      ? "purple"
                                      : p.status === "done"
                                        ? "green"
                                        : "gray"
                                  }
                                >
                                  {statusText[p.status] || "待读"}
                                </Badge>
                              </span>
                              <span className="muted">{date(p.createdAt)}</span>
                              <div className="row-actions">
                                <button
                                  title="编辑文献"
                                  onClick={() =>
                                    setModal({ kind: "papers", item: p })
                                  }
                                >
                                  <Pencil size={15} />
                                </button>
                                <button
                                  title="删除文献"
                                  onClick={() => void remove(p)}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <Empty
                          title={
                            paperQuery
                              ? "没有匹配的文献"
                              : "你的文献库，等待第一篇论文"
                          }
                          description="支持 PDF、BibTeX 和 RIS；所有导入资料保存在本机。"
                          action={
                            <button
                              className="primary"
                              onClick={() => startImport()}
                            >
                              <Upload size={16} />
                              导入资料
                            </button>
                          }
                        />
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="paper-detail-header">
                      <div>
                        <h2>{paper.title}</h2>
                        <p>
                          {paper.authors || "作者待补充"} ·{" "}
                          {paper.year || "年份待补充"}
                          {paper.doi && (
                            <>
                              {" "}
                              ·{" "}
                              <a
                                href={"https://doi.org/" + paper.doi}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {paper.doi}
                                <ExternalLink size={11} />
                              </a>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="actions">
                        <select
                          aria-label="阅读状态"
                          value={paper.status || "unread"}
                          onChange={(e) =>
                            void action(() =>
                              write(
                                "papers",
                                { status: e.target.value },
                                paper.id,
                              ),
                            )
                          }
                        >
                          <option value="unread">待读</option>
                          <option value="reading">阅读中</option>
                          <option value="done">已读完</option>
                        </select>
                        <button
                          className="icon-button"
                          title="编辑文献"
                          onClick={() =>
                            setModal({ kind: "papers", item: paper })
                          }
                        >
                          <Pencil size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="reading-workspace">
                      <aside className="reading-paper-list">
                        <div className="section-heading">
                          <h3>文献列表</h3>
                          <Library size={15} />
                        </div>
                        {filteredPapers.map((p) => (
                          <button
                            key={p.id}
                            className={p.id === paper.id ? "active" : ""}
                            onClick={() => openPaper(p.id)}
                          >
                            <FileText size={15} />
                            <span>
                              {p.title}
                              <small>{p.year || "—"}</small>
                            </span>
                          </button>
                        ))}
                      </aside>
                      <div className="reading-center">
                        {paperAttachments.length > 1 && (
                          <select
                            aria-label="选择 PDF 附件"
                            value={attachment?.id}
                            onChange={(e) =>
                              setSelectedAttachment(e.target.value)
                            }
                          >
                            {paperAttachments.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {attachment ? (
                          <Reader
                            key={attachment.id}
                            attachment={attachment}
                            annotations={paperAnnotations.filter(
                              (a) => a.attachmentId === attachment.id,
                            )}
                            reading={paper.reading}
                            jump={jump}
                            onPageChange={setCurrentPdfPage}
                            onReading={(reading) => {
                              void write(
                                "papers",
                                {
                                  reading,
                                  lastReadAt: new Date().toISOString(),
                                },
                                paper.id,
                              )
                                .then((updated) =>
                                  setData((prev) => ({
                                    ...prev,
                                    papers: prev.papers.map((p) =>
                                      p.id === paper.id ? updated : p,
                                    ),
                                  })),
                                )
                                .catch((e) => notify(e.message, true));
                            }}
                            onAnnotate={async (value) => {
                              await write("annotations", value);
                              await refresh();
                            }}
                          />
                        ) : (
                          <Empty
                            title="为这篇文献添加 PDF"
                            description={
                              paper.abstract ||
                              "已有文献信息，导入全文后即可阅读和批注。"
                            }
                            action={
                              <button
                                className="primary"
                                onClick={() => startImport(paper.id)}
                              >
                                <Upload size={15} />
                                添加 PDF 附件
                              </button>
                            }
                          />
                        )}
                      </div>
                      <aside className="reading-notes">
                        <div className="section-heading">
                          <h3>
                            <NotebookPen size={16} />
                            阅读笔记
                          </h3>
                          <button
                            title="新建论文笔记"
                            onClick={() =>
                              setModal({
                                kind: "notes",
                                defaults: {
                                  title: paper.title + " · 阅读笔记",
                                  paperId: paper.id,
                                  tags: [],
                                  body: "",
                                },
                              })
                            }
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                        {paperNotes.length ? (
                          paperNotes.map((n) => (
                            <div className="reader-note" key={n.id}>
                              <div className="note-caption">
                                <strong>{n.title}</strong>
                                <button
                                  title="打开完整笔记"
                                  onClick={() => openNote(n.id)}
                                >
                                  <ArrowUpRight size={14} />
                                </button>
                              </div>
                              <NoteEditor
                                key={n.id}
                                note={n}
                                compact
                                pageNumber={currentPdfPage}
                                onSave={async (body) => {
                                  await saveBody("notes", n.id, body);
                                }}
                                onPage={(p) =>
                                  setJump({ page: p, stamp: Date.now() })
                                }
                                onError={(e) => notify(e, true)}
                              />
                            </div>
                          ))
                        ) : (
                          <div className="quiet-empty">
                            <NotebookPen size={26} />
                            <p>写下你的第一个想法</p>
                            <button
                              className="text-link"
                              onClick={() =>
                                setModal({
                                  kind: "notes",
                                  defaults: {
                                    title: paper.title + " · 阅读笔记",
                                    paperId: paper.id,
                                    body: "",
                                    tags: [],
                                  },
                                })
                              }
                            >
                              新建阅读笔记
                            </button>
                          </div>
                        )}
                        <div className="section-heading annotation-heading">
                          <h3>
                            <Highlighter size={15} />
                            高亮与批注
                          </h3>
                          <span className="muted">
                            {paperAnnotations.length}
                          </span>
                        </div>
                        <div className="annotation-list">
                          {paperAnnotations.map((a) => (
                            <div key={a.id} className="annotation">
                              <button
                                className="annotation-quote"
                                onClick={() => {
                                  setSelectedAttachment(a.attachmentId);
                                  setJump({ page: a.page, stamp: Date.now() });
                                }}
                              >
                                <Badge color="orange">p. {a.page}</Badge>
                                <blockquote>{a.quote}</blockquote>
                                <p>{a.comment}</p>
                              </button>
                              <div className="annotation-actions">
                                <button
                                  title="编辑批注"
                                  onClick={() =>
                                    setModal({ kind: "annotations", item: a })
                                  }
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  title="删除批注"
                                  onClick={() => void remove(a)}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                          {!paperAnnotations.length && (
                            <p className="muted small-copy">
                              在 PDF 中选择文字，保存第一条高亮。
                            </p>
                          )}
                        </div>
                      </aside>
                    </div>
                  </>
                )}
              </>
            )}

            {page === "notes" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">CONNECTED KNOWLEDGE</div>
                    <h1>让想法生长</h1>
                    <p>记录阅读中的灵感，连接你的知识与研究。</p>
                  </div>
                  <div className="actions">
                    <button className="secondary" onClick={() => startImport()}>
                      <Upload size={15} />
                      导入 Markdown
                    </button>
                    <button
                      className="primary"
                      onClick={() =>
                        setModal({
                          kind: "notes",
                          defaults: { body: "", tags: [] },
                        })
                      }
                    >
                      <Plus size={17} />
                      新建笔记
                    </button>
                  </div>
                </div>
                <div className="notes-workspace panel">
                  <aside className="notes-list">
                    <div className="input-search">
                      <Search size={15} />
                      <input
                        aria-label="搜索笔记"
                        placeholder="查找笔记或标签"
                        value={noteQuery}
                        onChange={(e) => setNoteQuery(e.target.value)}
                      />
                    </div>
                    {data.notes
                      .filter((n) =>
                        (n.title + " " + n.tags?.join(" "))
                          .toLowerCase()
                          .includes(noteQuery.toLowerCase()),
                      )
                      .map((n) => (
                        <button
                          key={n.id}
                          className={note?.id === n.id ? "active" : ""}
                          onClick={() => setSelectedNote(n.id)}
                        >
                          <FileText size={17} />
                          <div>
                            <strong>{n.title}</strong>
                            <p>
                              {(n.body || n.sourceBody || "还没有内容")
                                .replace(/[#*`]/g, "")
                                .slice(0, 55)}
                            </p>
                            <small>
                              {date(n.updatedAt)}
                              {n.bindings?.some((b: any) => b.missing)
                                ? " · 来源缺失"
                                : ""}
                            </small>
                          </div>
                        </button>
                      ))}
                  </aside>
                  <div className="note-document">
                    {note ? (
                      <>
                        <div className="note-document-header">
                          <div>
                            <Badge color="purple">知识笔记</Badge>
                            <h2>{note.title}</h2>
                            <div className="paper-tags">
                              {note.tags?.map((t: string) => (
                                <span key={t}>#{t}</span>
                              ))}
                              {note.paperId && (
                                <button
                                  className="text-link"
                                  onClick={() => openPaper(note.paperId)}
                                >
                                  <Link2 size={12} />
                                  关联文献
                                </button>
                              )}
                              {note.projectId && (
                                <span>
                                  {
                                    data.projects.find(
                                      (p) => p.id === note.projectId,
                                    )?.title
                                  }
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="row-actions">
                            <button
                              title="导出此笔记"
                              onClick={() =>
                                download(
                                  note.title + ".md",
                                  (note.sourceBody || "") +
                                    "\n\n" +
                                    (note.body || ""),
                                )
                              }
                            >
                              <Download size={16} />
                            </button>
                            <button
                              title="编辑笔记信息"
                              onClick={() =>
                                setModal({ kind: "notes", item: note })
                              }
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              title="删除笔记"
                              onClick={() => void remove(note)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        {note.sourceBody && (
                          <details className="source-content" open>
                            <summary>导入的来源内容 · 刷新时更新</summary>
                            <Markdown
                              body={note.sourceBody}
                              note={note}
                              notes={data.notes}
                              onNote={openNote}
                            />
                          </details>
                        )}
                        <NoteEditor
                          key={note.id}
                          note={note}
                          notes={data.notes}
                          onNote={openNote}
                          onPage={(p) =>
                            note.paperId && openPaper(note.paperId, p)
                          }
                          onSave={async (body) => {
                            await saveBody("notes", note.id, body);
                          }}
                          onError={(e) => notify(e, true)}
                        />
                      </>
                    ) : (
                      <Empty
                        icon={<NotebookPen size={32} />}
                        title="留住每一个值得思考的想法"
                        description="新建笔记，或从 Obsidian 导入已有的知识积累。"
                      />
                    )}
                  </div>
                </div>
              </>
            )}

            {page === "tools" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">RESEARCH TOOLKIT</div>
                    <h1>好工具，让探索更从容</h1>
                    <p>收拢常用科研网站，为每一步研究找到顺手的工具。</p>
                  </div>
                  <div className="actions">
                    <button
                      className="secondary"
                      onClick={() => toolsImportRef.current?.click()}
                    >
                      <Upload size={15} />
                      导入工具
                    </button>
                    <button
                      className="primary"
                      onClick={() =>
                        setModal({
                          kind: "tools",
                          defaults: {
                            category: "文献检索",
                            tags: [],
                            order: 0,
                            favorite: false,
                          },
                        })
                      }
                    >
                      <Plus size={17} />
                      添加工具
                    </button>
                  </div>
                </div>
                <div className="utility-grid">
                  {[
                    {
                      id: "doi",
                      title: "DOI 清理",
                      desc: "从网址或引用中整理 DOI",
                      icon: Link2,
                    },
                    {
                      id: "bibtex",
                      title: "BibTeX 检查",
                      desc: "解析文献条目，检查导入格式",
                      icon: FileText,
                    },
                    {
                      id: "count",
                      title: "文本字数统计",
                      desc: "统计字符、英文词与中文字符",
                      icon: SlidersHorizontal,
                    },
                  ].map((u) => (
                    <button
                      key={u.id}
                      className="utility-card"
                      onClick={() => {
                        setUtility(u.id);
                        setUtilityText("");
                        setUtilityOutput("");
                      }}
                    >
                      <span>
                        <u.icon size={22} />
                      </span>
                      <div>
                        <h3>{u.title}</h3>
                        <p>{u.desc}</p>
                      </div>
                      <ArrowUpRight size={17} />
                    </button>
                  ))}
                </div>
                <div className="filter-bar">
                  <div className="tabs wrap">
                    {[
                      "全部工具",
                      "我的收藏",
                      ...new Set(
                        data.tools.map((t) => t.category || "其他工具"),
                      ),
                    ].map((c) => (
                      <button
                        key={c}
                        className={toolCategory === c ? "active" : ""}
                        onClick={() => setToolCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <div className="input-search">
                    <Search size={16} />
                    <input
                      aria-label="查找工具"
                      placeholder="搜索工具、用途或标签"
                      value={toolQuery}
                      onChange={(e) => setToolQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="tools-grid">
                  {data.tools
                    .filter(
                      (t) =>
                        (toolCategory === "全部工具" ||
                          (toolCategory === "我的收藏" && t.favorite) ||
                          t.category === toolCategory) &&
                        (
                          t.title +
                          " " +
                          t.description +
                          " " +
                          t.tags?.join(" ")
                        )
                          .toLowerCase()
                          .includes(toolQuery.toLowerCase()),
                    )
                    .sort((a, b) => (a.order || 0) - (b.order || 0))
                    .map((t) => (
                      <article className="tool-card" key={t.id}>
                        <div className="tool-card-top">
                          <span className="tool-letter">
                            {initials(t.title)}
                          </span>
                          <button
                            title={t.favorite ? "取消收藏" : "收藏"}
                            className={t.favorite ? "starred" : ""}
                            onClick={() =>
                              void action(() =>
                                write("tools", { favorite: !t.favorite }, t.id),
                              )
                            }
                          >
                            <Star
                              size={17}
                              fill={t.favorite ? "currentColor" : "none"}
                            />
                          </button>
                        </div>
                        <a
                          className="tool-title"
                          href={t.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t.title}
                          <ArrowUpRight size={15} />
                        </a>
                        <p>
                          {t.description ||
                            "添加说明，记录这个工具的最佳用途。"}
                        </p>
                        <div className="paper-tags">
                          {t.tags?.map((tag: string) => (
                            <span key={tag}>#{tag}</span>
                          ))}
                        </div>
                        <footer>
                          <Badge>{t.category || "其他工具"}</Badge>
                          <div className="row-actions">
                            <button
                              title="编辑工具"
                              onClick={() =>
                                setModal({ kind: "tools", item: t })
                              }
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              title="删除工具"
                              onClick={() => void remove(t)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </footer>
                      </article>
                    ))}
                </div>
                {!data.tools.length && (
                  <div className="panel">
                    <Empty
                      icon={<LayoutGrid size={30} />}
                      title="搭建你的科研工具箱"
                      description="添加常用网站，按研究流程分类；收藏的工具会显示在首页。"
                      action={
                        <button
                          className="primary"
                          onClick={() =>
                            setModal({
                              kind: "tools",
                              defaults: {
                                category: "文献检索",
                                tags: [],
                                favorite: true,
                                order: 0,
                              },
                            })
                          }
                        >
                          <Plus size={16} />
                          添加第一个工具
                        </button>
                      }
                    />
                  </div>
                )}
              </>
            )}

            {page === "projects" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">PROJECTS & NEXT STEPS</div>
                    <h1>{project ? project.title : "每个研究，都有下一步"}</h1>
                    <p>
                      {project
                        ? project.description ||
                          "连接资料，记录实验，让研究持续向前。"
                        : "把课题、任务和实验记录放在同一个空间。"}
                    </p>
                  </div>
                  <div className="actions">
                    {project && (
                      <>
                        <button
                          className="secondary"
                          onClick={() => {
                            setSelectedProject(undefined);
                            setSelectedExperiment(undefined);
                          }}
                        >
                          全部课题
                        </button>
                        <button
                          className="secondary"
                          onClick={() =>
                            setModal({ kind: "projects", item: project })
                          }
                        >
                          <Pencil size={15} />
                          编辑课题
                        </button>
                      </>
                    )}
                    <button
                      className="primary"
                      onClick={() =>
                        setModal({
                          kind: "projects",
                          defaults: {
                            status: "doing",
                            paperIds: [],
                            noteIds: [],
                            toolIds: [],
                          },
                        })
                      }
                    >
                      <Plus size={17} />
                      新建课题
                    </button>
                  </div>
                </div>
                {!project && (
                  <div className="project-cards">
                    {data.projects.map((p, i) => {
                      const tasks = data.tasks.filter(
                          (t) => t.projectId === p.id,
                        ),
                        done = tasks.filter((t) => t.status === "done").length;
                      return (
                        <article className="panel project-card" key={p.id}>
                          <div className="section-heading">
                            <span className={`mini-folder tone-${i % 3}`}>
                              <Folder size={23} />
                            </span>
                            <div className="row-actions">
                              <button
                                title="编辑课题"
                                onClick={() =>
                                  setModal({ kind: "projects", item: p })
                                }
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                title="删除课题"
                                onClick={() => void remove(p)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                          <button
                            className="project-open"
                            onClick={() => setSelectedProject(p.id)}
                          >
                            <h2>{p.title}</h2>
                            <p>
                              {p.description ||
                                "添加课题说明，明确你的研究目标。"}
                            </p>
                          </button>
                          <Badge color={p.status === "done" ? "gray" : "green"}>
                            {p.status === "done" ? "已完成" : "进行中"}
                          </Badge>
                          <div className="progress-track">
                            <i
                              style={{
                                width:
                                  (tasks.length
                                    ? (done / tasks.length) * 100
                                    : 0) + "%",
                              }}
                            />
                          </div>
                          <footer>
                            <span>
                              {done}/{tasks.length} 项任务已完成
                            </span>
                            <button
                              className="text-link"
                              onClick={() => setSelectedProject(p.id)}
                            >
                              进入课题
                              <ArrowRight size={14} />
                            </button>
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                )}
                {project && (
                  <div className="project-resources panel">
                    <h3>
                      <Link2 size={16} />
                      课题资料
                    </h3>
                    <div>
                      {(project.paperIds || []).map((id: string) => {
                        const p = data.papers.find((p) => p.id === id);
                        return (
                          p && (
                            <button
                              className="resource-chip"
                              key={id}
                              onClick={() => openPaper(id)}
                            >
                              <BookOpen size={14} />
                              {p.title}
                            </button>
                          )
                        );
                      })}
                      {[
                        ...new Set([
                          ...(project.noteIds || []),
                          ...data.notes
                            .filter((n) => n.projectId === project.id)
                            .map((n) => n.id),
                        ]),
                      ].map((id) => {
                        const n = data.notes.find((n) => n.id === id);
                        return (
                          n && (
                            <button
                              className="resource-chip"
                              key={id}
                              onClick={() => openNote(id)}
                            >
                              <NotebookPen size={14} />
                              {n.title}
                            </button>
                          )
                        );
                      })}
                      {(project.toolIds || []).map((id: string) => {
                        const t = data.tools.find((t) => t.id === id);
                        return (
                          t && (
                            <a
                              className="resource-chip"
                              key={id}
                              href={t.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <LayoutGrid size={14} />
                              {t.title}
                              <ExternalLink size={12} />
                            </a>
                          )
                        );
                      })}
                      <button
                        className="text-link"
                        onClick={() =>
                          setModal({ kind: "projects", item: project })
                        }
                      >
                        <Plus size={14} />
                        关联资料
                      </button>
                    </div>
                  </div>
                )}
                <div className="section-heading standalone">
                  <h2>
                    <CheckCircle2 size={19} />
                    {project ? "课题任务" : "全部任务"}
                  </h2>
                  <button
                    className="secondary small"
                    onClick={() =>
                      setModal({
                        kind: "tasks",
                        defaults: {
                          projectId: project?.id || "",
                          status: "todo",
                          priority: "normal",
                        },
                      })
                    }
                  >
                    <Plus size={15} />
                    添加任务
                  </button>
                </div>
                <div className="kanban">
                  {[
                    ["todo", "待办"],
                    ["doing", "进行中"],
                    ["done", "已完成"],
                  ].map(([status, label]) => (
                    <section key={status} className={"kanban-column " + status}>
                      <h3>
                        <i />
                        {label}
                        <span>
                          {
                            data.tasks.filter(
                              (t) =>
                                (!project || t.projectId === project.id) &&
                                t.status === status,
                            ).length
                          }
                        </span>
                      </h3>
                      {data.tasks
                        .filter(
                          (t) =>
                            (!project || t.projectId === project.id) &&
                            t.status === status,
                        )
                        .map((t) => (
                          <article className="task-card" key={t.id}>
                            <div className="section-heading">
                              <Badge
                                color={
                                  t.priority === "high" ? "orange" : "gray"
                                }
                              >
                                {t.priority === "high"
                                  ? "高优先级"
                                  : t.priority === "low"
                                    ? "低优先级"
                                    : "普通"}
                              </Badge>
                              <div className="row-actions">
                                <button
                                  title="编辑任务"
                                  onClick={() =>
                                    setModal({ kind: "tasks", item: t })
                                  }
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  title="删除任务"
                                  onClick={() => void remove(t)}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                            <h4>{t.title}</h4>
                            {t.description && <p>{t.description}</p>}
                            <footer>
                              <span>
                                <CalendarDays size={12} />
                                {t.dueDate || "无截止日期"}
                              </span>
                              <select
                                aria-label={`任务“${t.title}”状态`}
                                value={t.status}
                                onChange={(e) =>
                                  void action(() =>
                                    write(
                                      "tasks",
                                      { status: e.target.value },
                                      t.id,
                                    ),
                                  )
                                }
                              >
                                <option value="todo">待办</option>
                                <option value="doing">进行中</option>
                                <option value="done">已完成</option>
                              </select>
                            </footer>
                          </article>
                        ))}
                      <button
                        className="kanban-add"
                        onClick={() =>
                          setModal({
                            kind: "tasks",
                            defaults: {
                              projectId: project?.id || "",
                              status,
                              priority: "normal",
                            },
                          })
                        }
                      >
                        <Plus size={14} />
                        添加任务
                      </button>
                    </section>
                  ))}
                </div>
                <section className="panel experiment-panel">
                  <div className="section-heading">
                    <h2>
                      <FlaskConical size={18} />
                      实验记录
                    </h2>
                    <button
                      className="secondary small"
                      onClick={() =>
                        setModal({
                          kind: "experiments",
                          defaults: {
                            projectId: project?.id || "",
                            body: "",
                            date: new Date().toLocaleDateString("sv-SE"),
                          },
                        })
                      }
                    >
                      <Plus size={15} />
                      新建记录
                    </button>
                  </div>
                  <div className="experiment-workspace">
                    <div className="experiment-list">
                      {data.experiments
                        .filter((e) => !project || e.projectId === project.id)
                        .map((e) => (
                          <button
                            key={e.id}
                            className={experiment?.id === e.id ? "active" : ""}
                            onClick={() => setSelectedExperiment(e.id)}
                          >
                            <FlaskConical size={15} />
                            <span>
                              {e.title}
                              <small>{e.date}</small>
                            </span>
                          </button>
                        ))}
                      {!data.experiments.filter(
                        (e) => !project || e.projectId === project.id,
                      ).length && <p className="muted">还没有实验记录</p>}
                    </div>
                    {experiment ? (
                      <div className="experiment-document">
                        <div className="section-heading">
                          <h3>{experiment.title}</h3>
                          <div className="row-actions">
                            <button
                              title="编辑实验记录信息"
                              onClick={() =>
                                setModal({
                                  kind: "experiments",
                                  item: experiment,
                                })
                              }
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              title="删除实验记录"
                              onClick={() => void remove(experiment)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                        <NoteEditor
                          key={experiment.id}
                          note={experiment}
                          onSave={async (body) => {
                            await saveBody("experiments", experiment.id, body);
                          }}
                          onError={(e) => notify(e, true)}
                        />
                        <div className="experiment-attachments">
                          {data.attachments
                            .filter((a) => a.ownerId === experiment.id)
                            .map((a) => (
                              <span className="resource-chip" key={a.id}>
                                <a
                                  href={`/api/attachments/${a.id}/file`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {a.name}
                                </a>
                                <button
                                  title="移除附件记录"
                                  onClick={() => void remove(a)}
                                >
                                  <X size={12} />
                                </button>
                              </span>
                            ))}
                          <button
                            className="secondary small"
                            onClick={() => experimentRef.current?.click()}
                          >
                            <Upload size={14} />
                            添加附件
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="quiet-empty">
                        <FlaskConical size={28} />
                        <p>记录方法、观察与下一步</p>
                        <small>选择或新建一则实验记录。</small>
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}

            {page === "settings" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">YOUR DATA, YOUR SPACE</div>
                    <h1>连接资料，安心积累</h1>
                    <p>手动刷新外部资料，本地保存你的阅读、批注与思考。</p>
                  </div>
                  <Badge color="green">
                    <Database size={13} />
                    本地优先
                  </Badge>
                </div>
                <section className="panel settings-panel">
                  <div className="section-heading">
                    <h2>
                      <Link2 size={18} />
                      资料来源
                    </h2>
                    <button
                      className="primary small"
                      onClick={() =>
                        setModal({
                          kind: "sources",
                          defaults: { type: "folder", title: "本地资料目录" },
                        })
                      }
                    >
                      <Plus size={15} />
                      添加来源
                    </button>
                  </div>
                  <p className="section-description">
                    支持 Zotero、Obsidian
                    和本地目录。按需导入与刷新，保留原始文件。
                  </p>
                  {data.sources.map((s) => (
                    <div className="source-row" key={s.id}>
                      <span
                        className={
                          "source-icon " +
                          (s.type === "zotero" ? "red" : "purple")
                        }
                      >
                        {s.type === "zotero" ? (
                          "Z"
                        ) : s.type === "obsidian" ? (
                          "O"
                        ) : (
                          <Folder size={22} />
                        )}
                      </span>
                      <div>
                        <strong>{s.title}</strong>
                        <p>
                          {s.type === "zotero"
                            ? `Zotero · 用户 ${s.userId} · ${s.hasKey ? "密钥已配置" : "待配置 API Key"}`
                            : s.path}
                        </p>
                        <small>
                          最近导入：
                          {s.lastImportedAt
                            ? new Date(s.lastImportedAt).toLocaleString("zh-CN")
                            : "尚未导入"}
                        </small>
                      </div>
                      <div className="actions">
                        <button
                          className="secondary small"
                          disabled={
                            busy ||
                            data.imports.some(
                              (r) =>
                                r.status === "running" && r.sourceId === s.id,
                            )
                          }
                          onClick={() =>
                            void action(
                              () =>
                                api(`/sources/${s.id}/refresh`, {
                                  method: "POST",
                                }),
                              "来源刷新已开始",
                            )
                          }
                        >
                          <RefreshCw size={14} />
                          刷新
                        </button>
                        <button
                          title="编辑来源"
                          onClick={() => setModal({ kind: "sources", item: s })}
                        >
                          <Pencil size={15} />
                        </button>
                        <button title="删除来源" onClick={() => void remove(s)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {!data.sources.length && (
                    <div className="source-intro">
                      <div>
                        <span className="source-icon red">Z</span>
                        <strong>Zotero</strong>
                        <p>手动拉取文献与可访问附件</p>
                        <button
                          className="text-link"
                          onClick={() =>
                            setModal({
                              kind: "sources",
                              defaults: {
                                type: "zotero",
                                title: "我的 Zotero 文献库",
                              },
                            })
                          }
                        >
                          连接文献库
                          <ArrowRight size={12} />
                        </button>
                      </div>
                      <div>
                        <span className="source-icon purple">O</span>
                        <strong>Obsidian</strong>
                        <p>从本地库导入笔记与关联资料</p>
                        <button
                          className="text-link"
                          onClick={() =>
                            setModal({
                              kind: "sources",
                              defaults: {
                                type: "obsidian",
                                title: "我的 Obsidian 笔记库",
                              },
                            })
                          }
                        >
                          添加笔记库
                          <ArrowRight size={12} />
                        </button>
                      </div>
                      <div>
                        <span className="source-icon blue">
                          <Folder size={22} />
                        </span>
                        <strong>本地资料</strong>
                        <p>扫描目录中的 PDF、文献与笔记</p>
                        <button
                          className="text-link"
                          onClick={() =>
                            setModal({
                              kind: "sources",
                              defaults: {
                                type: "folder",
                                title: "本地资料目录",
                              },
                            })
                          }
                        >
                          选择资料目录
                          <ArrowRight size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </section>
                <div className="settings-grid">
                  <section className="panel settings-panel">
                    <div className="section-heading">
                      <h2>
                        <Archive size={18} />
                        备份与恢复
                      </h2>
                    </div>
                    <p className="section-description">
                      完整备份包含资料、附件、笔记与批注，不包含 Zotero API
                      Key。恢复将替换当前工作台内容，请先备份。
                    </p>
                    <div className="backup-actions">
                      <a className="secondary" href="/api/backup" download>
                        <Download size={16} />
                        下载完整备份
                      </a>
                      <button
                        className="secondary"
                        onClick={() => {
                          if (
                            confirm(
                              "恢复将替换当前所有工作台内容。请确认已经下载当前备份，再选择要恢复的 ZIP 文件。",
                            )
                          )
                            restoreRef.current?.click();
                        }}
                      >
                        <RefreshCw size={15} />
                        从备份恢复
                      </button>
                    </div>
                    <div className="data-counts">
                      <span>
                        <strong>{data.papers.length}</strong>篇文献
                      </span>
                      <span>
                        <strong>{data.notes.length}</strong>则笔记
                      </span>
                      <span>
                        <strong>{data.attachments.length}</strong>个附件
                      </span>
                    </div>
                  </section>
                  <section className="panel settings-panel">
                    <div className="section-heading">
                      <h2>
                        <ArrowDownToLine size={18} />
                        开放格式导出
                      </h2>
                    </div>
                    <p className="section-description">
                      把积累带到其他工具中继续使用。
                    </p>
                    <div className="export-links">
                      <a href="/api/export/papers.bib" download>
                        <FileText size={17} />
                        <span>
                          文献库<small>BibTeX 格式</small>
                        </span>
                        <Download size={15} />
                      </a>
                      <a href="/api/export/notes.md" download>
                        <NotebookPen size={17} />
                        <span>
                          知识笔记<small>Markdown 格式</small>
                        </span>
                        <Download size={15} />
                      </a>
                      <a href="/api/export/tools.json" download>
                        <LayoutGrid size={17} />
                        <span>
                          科研工具列表<small>JSON 格式</small>
                        </span>
                        <Download size={15} />
                      </a>
                    </div>
                  </section>
                </div>
                <section className="panel settings-panel">
                  <div className="section-heading">
                    <h2>
                      <Search size={18} />
                      外部学术检索入口
                    </h2>
                    <button
                      className="secondary small"
                      onClick={() =>
                        setModal({ kind: "settings", item: data.settings[0] })
                      }
                    >
                      <Pencil size={14} />
                      编辑入口
                    </button>
                  </div>
                  <p className="section-description">
                    全局搜索后可将关键词带到外部网站，网址模板使用 {"{query}"}{" "}
                    占位。
                  </p>
                  <div className="external-links">
                    {data.settings[0]?.searchEngines?.map((e: any) => (
                      <span className="resource-chip" key={e.name}>
                        {e.name}
                        <ExternalLink size={12} />
                      </span>
                    ))}
                  </div>
                </section>
                <section className="panel settings-panel">
                  <div className="section-heading">
                    <h2>
                      <Clock3 size={18} />
                      导入与刷新记录
                    </h2>
                    <button
                      title="刷新记录"
                      onClick={() => void action(refresh)}
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>
                  {[...data.imports].reverse().map((r) => (
                    <div className="import-report" key={r.id}>
                      <div className="section-heading">
                        <strong>
                          {r.status === "running" ? (
                            <LoaderCircle size={15} className="spin" />
                          ) : (
                            <CheckCircle2 size={15} />
                          )}{" "}
                          {r.title}
                        </strong>
                        <Badge
                          color={
                            r.status === "running"
                              ? "purple"
                              : r.status === "failed"
                                ? "orange"
                                : "green"
                          }
                        >
                          {r.status === "running"
                            ? "处理中"
                            : r.status === "failed"
                              ? "未完成"
                              : "已完成"}
                        </Badge>
                      </div>
                      <p>
                        {r.completed}/{r.total} 项 · 成功 {r.success} ·
                        重复或更新 {r.duplicate} · 失败{" "}
                        {r.failures?.length || 0}
                        <span className="report-date">
                          {new Date(r.createdAt).toLocaleString("zh-CN")}
                        </span>
                      </p>
                      {r.status === "running" && (
                        <div className="progress-track">
                          <i
                            style={{
                              width:
                                (r.total ? (r.completed / r.total) * 100 : 5) +
                                "%",
                            }}
                          />
                        </div>
                      )}
                      {r.failures?.length > 0 && (
                        <details>
                          <summary>查看失败原因</summary>
                          {r.failures.map((f: any, i: number) => (
                            <p className="inline-error" key={i}>
                              {f.name}：{f.message}
                            </p>
                          ))}
                          <button
                            className="secondary small"
                            disabled={busy || r.status === "running"}
                            onClick={() =>
                              void action(
                                () =>
                                  api(`/imports/${r.id}/retry`, {
                                    method: "POST",
                                  }),
                                "已开始重新处理；重复条目将自动识别",
                              )
                            }
                          >
                            <RefreshCw size={13} />
                            重试此批导入
                          </button>
                        </details>
                      )}
                      {r.candidates
                        ?.filter((c: any) =>
                          data.papers.some((p) => p.id === c.incomingId),
                        )
                        .map((c: any) => (
                          <div
                            className="duplicate-candidate"
                            key={c.incomingId}
                          >
                            <span>发现同名同年文献：{c.title}</span>
                            <button
                              className="secondary small"
                              onClick={() => {
                                if (
                                  confirm(
                                    "合并这两条文献？保留已有文献信息，并转移附件、笔记与批注。",
                                  )
                                )
                                  void action(
                                    () =>
                                      api("/papers/merge", {
                                        method: "POST",
                                        body: JSON.stringify(c),
                                      }),
                                    "文献已合并",
                                  );
                              }}
                            >
                              确认合并
                            </button>
                          </div>
                        ))}
                    </div>
                  ))}
                  {!data.imports.length && (
                    <p className="muted">
                      还没有导入记录。你可以直接导入文件，或添加资料来源。
                    </p>
                  )}
                </section>
              </>
            )}
            <footer className="page-footer">
              <span>研序 RESEARCH DESK</span>
              <span>让研究井然有序，让思考自由生长。</span>
              <span>
                <i />
                本地个人工作台
              </span>
            </footer>
          </main>
        )}
      </div>

      {modal && (
        <EntityModal
          key={modal.item?.id || modal.kind}
          modal={modal}
          data={data}
          onClose={() => setModal(undefined)}
          onSave={async (values) => {
            await write(modal.kind, values, modal.item?.id);
            await refresh();
            setModal(undefined);
            notify("已保存");
          }}
        />
      )}
      {utility && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) =>
            e.target === e.currentTarget && setUtility(undefined)
          }
        >
          <section className="modal">
            <div className="section-heading">
              <h2>
                {
                  {
                    doi: "DOI 清理",
                    bibtex: "BibTeX 检查",
                    count: "文本字数统计",
                  }[utility]
                }
              </h2>
              <button title="关闭" onClick={() => setUtility(undefined)}>
                <X size={20} />
              </button>
            </div>
            <textarea
              className="utility-input"
              aria-label="待处理文本"
              placeholder={
                utility === "bibtex" ? "粘贴 BibTeX 条目…" : "在这里粘贴文本…"
              }
              value={utilityText}
              onChange={(e) => setUtilityText(e.target.value)}
            />
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                try {
                  if (utility === "doi")
                    setUtilityOutput(
                      utilityText
                        .split(/\r?\n/)
                        .map(normalizeDoi)
                        .filter(Boolean)
                        .join("\n"),
                    );
                  else if (utility === "count")
                    setUtilityOutput(
                      `总字符：${[...utilityText].length}\n不含空白：${[...utilityText.replace(/\s/g, "")].length}\n英文词数：${utilityText.match(/[a-zA-Z]+(?:['’-][a-zA-Z]+)*/g)?.length || 0}\n中文字符：${utilityText.match(/\p{Script=Han}/gu)?.length || 0}`,
                    );
                  else {
                    const parsed = await api("/utilities/bibtex", {
                      method: "POST",
                      body: JSON.stringify({ text: utilityText }),
                    });
                    setUtilityOutput(
                      `解析成功，共 ${parsed.length} 条文献\n\n` +
                        JSON.stringify(parsed, null, 2),
                    );
                  }
                } catch (e) {
                  setUtilityOutput("解析失败：" + (e as Error).message);
                }
              }}
            >
              处理文本
            </button>
            {utilityOutput && (
              <pre className="utility-output">{utilityOutput}</pre>
            )}
          </section>
        </div>
      )}
      {notice && (
        <div className={`toast ${notice.error ? "error" : ""}`} role="status">
          {notice.error ? <X size={17} /> : <CheckCircle2 size={17} />}
          <span>{notice.text}</span>
          <button title="关闭提示" onClick={() => setNotice(undefined)}>
            <X size={15} />
          </button>
        </div>
      )}
      <input
        hidden
        ref={importRef}
        type="file"
        multiple
        accept=".pdf,.bib,.ris,.md"
        onChange={(e) => void upload(e.target.files)}
      />
      <input
        hidden
        ref={restoreRef}
        type="file"
        accept=".zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const form = new FormData();
          form.append("file", f);
          void action(
            () => api("/restore", { method: "POST", body: form }),
            "备份已恢复。Zotero 来源可能需要重新配置密钥。",
          );
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={toolsImportRef}
        type="file"
        accept=".json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          void action(
            async () =>
              api("/tools/import", { method: "POST", body: await f.text() }),
            "工具列表已导入",
          );
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={experimentRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.json,.zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f || !experiment) return;
          const form = new FormData();
          form.append("file", f);
          void action(
            () =>
              api(`/experiments/${experiment.id}/attachments`, {
                method: "POST",
                body: form,
              }),
            "附件已添加",
          );
          e.target.value = "";
        }}
      />
    </div>
  );
}

function NoteEditor({
  note,
  onSave,
  onError,
  onPage,
  onNote,
  notes = [],
  compact = false,
  pageNumber = 1,
}: {
  note: Item;
  onSave: (body: string) => Promise<void>;
  onError: (message: string) => void;
  onPage?: (page: number) => void;
  onNote?: (id: string) => void;
  notes?: Item[];
  compact?: boolean;
  pageNumber?: number;
}) {
  const [body, setBody] = useState(note.body || ""),
    [preview, setPreview] = useState(false),
    [status, setStatus] = useState("已保存");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    pending = useRef<string | undefined>(undefined),
    chain = useRef(Promise.resolve());
  const saveRef = useRef(onSave),
    errorRef = useRef(onError);
  saveRef.current = onSave;
  errorRef.current = onError;
  const flush = () => {
    if (pending.current === undefined) return;
    const value = pending.current;
    pending.current = undefined;
    setStatus("保存中…");
    chain.current = chain.current
      .catch(() => {})
      .then(() => saveRef.current(value))
      .then(() => {
        if (pending.current === undefined) setStatus("已保存");
      })
      .catch((e) => {
        setStatus("保存失败");
        errorRef.current(e.message);
        if (pending.current === undefined) pending.current = value;
      });
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      flush();
    },
    [],
  );
  function change(value: string) {
    setBody(value);
    pending.current = value;
    setStatus("等待保存…");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 650);
  }
  return (
    <div className={"note-editor " + (compact ? "compact" : "")}>
      <div className="editor-toolbar">
        <div className="segmented">
          <button
            className={!preview ? "active" : ""}
            onClick={() => setPreview(false)}
          >
            编辑
          </button>
          <button
            className={preview ? "active" : ""}
            onClick={() => setPreview(true)}
          >
            预览
          </button>
        </div>
        {onPage && (
          <button
            className="text-link"
            onClick={() => {
              change(body + `\n[第 ${pageNumber} 页](#page-${pageNumber})\n`);
              setPreview(false);
            }}
          >
            <Link2 size={12} />
            插入页码
          </button>
        )}
        <span
          className={
            status === "保存失败" ? "save-status failed" : "save-status"
          }
          onClick={() => status === "保存失败" && flush()}
        >
          {status === "已保存" && <Check size={11} />} {status}
        </span>
      </div>
      {preview ? (
        <Markdown
          body={body || "*还没有笔记内容*"}
          note={note}
          notes={notes}
          onNote={onNote}
          onPage={onPage}
        />
      ) : (
        <textarea
          aria-label="Markdown 笔记"
          placeholder={
            note.sourceBody
              ? "写下你对来源内容的补充与思考…"
              : "用 Markdown 记录想法…\n\n## 研究问题\n## 方法与发现\n## 我的思考"
          }
          value={body}
          onChange={(e) => change(e.target.value)}
          onBlur={flush}
        />
      )}
      <div className="editor-foot">
        <span>Markdown · 自动保存</span>
        <span>{body.length} 字符</span>
      </div>
    </div>
  );
}

function EntityModal({
  modal,
  data,
  onClose,
  onSave,
}: {
  modal: Modal;
  data: State;
  onClose: () => void;
  onSave: (values: Draft) => Promise<void>;
}) {
  const { kind, item } = modal;
  const [values, setValues] = useState<Draft>({ ...modal.defaults, ...item }),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saving]);
  const update = (key: string, value: any) =>
    setValues((v) => ({ ...v, [key]: value }));
  const text = (
    key: string,
    label: string,
    options: {
      area?: boolean;
      type?: string;
      required?: boolean;
      placeholder?: string;
    } = {},
  ) => (
    <label className={options.area ? "full-width" : ""} key={key}>
      <span>
        {label}
        {options.required && <em>*</em>}
      </span>
      {options.area ? (
        <textarea
          value={values[key] || ""}
          placeholder={options.placeholder}
          onChange={(e) => update(key, e.target.value)}
        />
      ) : (
        <input
          autoFocus={key === "title"}
          required={options.required}
          type={options.type || "text"}
          value={values[key] ?? ""}
          placeholder={options.placeholder}
          onChange={(e) =>
            update(
              key,
              options.type === "number"
                ? Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
    </label>
  );
  const select = (
    key: string,
    label: string,
    choices: { id: string; title: string }[],
    multiple = false,
  ) => (
    <label className={multiple ? "full-width" : ""} key={key}>
      <span>
        {label}
        {multiple && <small>按住 Ctrl 可多选</small>}
      </span>
      <select
        multiple={multiple}
        value={values[key] || (multiple ? [] : "")}
        onChange={(e) =>
          update(
            key,
            multiple
              ? Array.from(e.target.selectedOptions).map((o) => o.value)
              : e.target.value,
          )
        }
      >
        {!multiple && ["paperId", "projectId"].includes(key) && (
          <option value="">未关联／未设置</option>
        )}
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
    </label>
  );
  const tags = (
    <label className="full-width">
      <span>标签</span>
      <input
        value={Array.isArray(values.tags) ? values.tags.join(", ") : ""}
        placeholder="用逗号分隔，例如：流体力学, 方法论"
        onChange={(e) =>
          update(
            "tags",
            e.target.value.split(/[,，]/).map((t) => t.trim()),
          )
        }
      />
    </label>
  );
  const labels: Partial<Record<Kind, string>> = {
    papers: "文献",
    notes: "笔记",
    tools: "工具",
    projects: "课题",
    tasks: "任务",
    experiments: "实验记录",
    sources: "资料来源",
    annotations: "批注",
    settings: "检索入口",
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={(item ? "编辑" : "添加") + labels[kind]}
      >
        <div className="section-heading">
          <h2>
            {item ? "编辑" : "添加"}
            {labels[kind]}
          </h2>
          <button title="关闭弹窗" disabled={saving} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError("");
            try {
              const v = { ...values };
              if (v.tags) v.tags = v.tags.filter(Boolean);
              delete v.hasKey;
              if (kind === "sources" && item?.hasKey && v.apiKey === "")
                delete v.apiKey;
              await onSave(v);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="form-grid">
            {!["annotations", "settings"].includes(kind) &&
              text("title", kind === "tools" ? "工具名称" : "标题", {
                required: true,
              })}
            {kind === "papers" && (
              <>
                {text("authors", "作者")}
                {text("year", "年份")}
                {text("journal", "期刊／来源")}
                {text("doi", "DOI")}
                {select("status", "阅读状态", [
                  { id: "unread", title: "待读" },
                  { id: "reading", title: "阅读中" },
                  { id: "done", title: "已读完" },
                ])}
                {text("abstract", "摘要", { area: true })}
                {tags}
              </>
            )}
            {kind === "notes" && (
              <>
                {select("paperId", "关联文献", data.papers)}
                {select("projectId", "关联课题", data.projects)}
                {tags}
              </>
            )}
            {kind === "tools" && (
              <>
                {text("url", "网站地址", {
                  type: "url",
                  required: true,
                  placeholder: "https://…",
                })}
                {text("category", "分类")}
                {text("order", "排序值", { type: "number" })}
                {text("description", "用途说明", { area: true })}
                {tags}
                <label className="checkbox-label full-width">
                  <input
                    type="checkbox"
                    checked={!!values.favorite}
                    onChange={(e) => update("favorite", e.target.checked)}
                  />
                  收藏到首页
                </label>
              </>
            )}
            {kind === "projects" && (
              <>
                {select("status", "课题状态", [
                  { id: "doing", title: "进行中" },
                  { id: "done", title: "已完成" },
                ])}
                {text("description", "研究目标与说明", { area: true })}
                {select("paperIds", "关联文献", data.papers, true)}
                {select("noteIds", "关联笔记", data.notes, true)}
                {select("toolIds", "关联工具", data.tools, true)}
              </>
            )}
            {kind === "tasks" && (
              <>
                {select("projectId", "关联课题", data.projects)}
                {select("status", "任务状态", [
                  { id: "todo", title: "待办" },
                  { id: "doing", title: "进行中" },
                  { id: "done", title: "已完成" },
                ])}
                {select("priority", "优先级", [
                  { id: "low", title: "低" },
                  { id: "normal", title: "普通" },
                  { id: "high", title: "高" },
                ])}
                {text("dueDate", "截止日期", { type: "date" })}
                {text("description", "任务说明", { area: true })}
              </>
            )}
            {kind === "experiments" && (
              <>
                {select("projectId", "关联课题", data.projects)}
                {text("date", "实验日期", { type: "date" })}
              </>
            )}
            {kind === "annotations" && (
              <>
                <div className="full-width quote-preview">{values.quote}</div>
                {text("comment", "批注内容", { area: true })}
              </>
            )}
            {kind === "sources" && (
              <>
                {select("type", "来源类型", [
                  { id: "folder", title: "本地目录" },
                  { id: "obsidian", title: "Obsidian 库" },
                  { id: "zotero", title: "Zotero Web API" },
                ])}
                {values.type === "zotero" ? (
                  <>
                    {text("userId", "Zotero 用户 ID", { required: true })}
                    {text(
                      "apiKey",
                      item?.hasKey ? "API Key（留空保留现有密钥）" : "API Key",
                      { type: "password", required: !item?.hasKey },
                    )}
                    <p className="form-help full-width">
                      在 Zotero 账户设置 → Feeds/API
                      中创建只读密钥。密钥仅由本机后端使用，不包含在备份中。
                    </p>
                  </>
                ) : (
                  <>
                    {text("path", "本地库／资料目录完整路径", {
                      required: true,
                      placeholder: "D:\\科研资料\\文献库",
                    })}
                    <p className="form-help full-width">
                      将资源管理器地址栏中的完整目录路径粘贴到这里。仅扫描此目录及其子目录，跳过隐藏目录和符号链接。
                    </p>
                  </>
                )}
              </>
            )}
            {kind === "settings" && (
              <label className="full-width">
                <span>每行一个：名称 | URL 模板</span>
                <textarea
                  className="engine-input"
                  defaultValue={values.searchEngines
                    ?.map((e: any) => `${e.name} | ${e.url}`)
                    .join("\n")}
                  onChange={(e) =>
                    update(
                      "searchEngines",
                      e.target.value
                        .split("\n")
                        .filter((l) => l.trim())
                        .map((l) => {
                          const index = l.indexOf("|");
                          return {
                            name: l.slice(0, index).trim(),
                            url: l.slice(index + 1).trim(),
                          };
                        }),
                    )
                  }
                />
              </label>
            )}
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-footer">
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={onClose}
            >
              取消
            </button>
            <button className="primary" disabled={saving}>
              {saving ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              保存{labels[kind]}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
