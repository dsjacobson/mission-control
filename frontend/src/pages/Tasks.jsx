import React, { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { CheckCircle2, Trash2, Plus, User, Bot, Loader2, RotateCcw } from "lucide-react";
import api from "../lib/api";
import { PageHeader, Section, EmptyState, formatRelative } from "../components/Bits";
import { useClients } from "../lib/ClientContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { toast } from "sonner";

const STATUS_LABEL = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
};

const STATUS_TONE = {
  open: "bg-slate-800 text-slate-200 border-slate-700",
  in_progress: "bg-amber-950/60 text-amber-200 border-amber-800",
  done: "bg-emerald-950/60 text-emerald-200 border-emerald-800",
  blocked: "bg-rose-950/60 text-rose-200 border-rose-800",
};

const RECURRENCE_LABEL = {
  none: "One-off",
  daily: "Daily",
  weekly: "Weekly",
};

function isDue(task) {
  if (!task.due_at) return false;
  return new Date(task.due_at).getTime() <= Date.now();
}

export default function Tasks() {
  const { clientId } = useParams();
  const { activeClient, clients } = useClients();
  const [tasks, setTasks] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const scope = clientId || activeClient?.id;

  const loadWorkers = async () => {
    try {
      const data = await api.listWorkers(true);
      setWorkers(data || []);
    } catch (err) {
      // Non-fatal — page still works, assignee UI will show IDs
    }
  };

  const loadTasks = async () => {
    if (!scope) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = { client_id: scope };
    if (statusFilter !== "all") params.status = statusFilter;
    if (assigneeFilter !== "all") params.assignee_id = assigneeFilter;
    try {
      const data = await api.listAssignableTasks(params);
      setTasks(data || []);
    } catch (err) {
      toast.error("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadWorkers(); }, []);
  useEffect(() => { loadTasks(); }, [scope, statusFilter, assigneeFilter]);

  const workerName = (id) => {
    if (!id) return "Unassigned";
    const w = workers.find((w) => w.id === id);
    return w ? w.name : id.slice(0, 8);
  };

  const workerIcon = (id) => {
    if (!id) return null;
    const w = workers.find((w) => w.id === id);
    if (!w) return null;
    return w.type === "agent"
      ? <Bot className="h-3.5 w-3.5 text-indigo-400" />
      : <User className="h-3.5 w-3.5 text-slate-400" />;
  };

  const dueBadge = (task) => {
    if (!task.due_at) return null;
    const due = new Date(task.due_at);
    const overdue = due.getTime() < Date.now() && task.status !== "done";
    return (
      <span className={`text-xs ${overdue ? "text-rose-400" : "text-slate-400"}`}>
        {overdue ? "Overdue · " : "Due · "}{formatRelative(task.due_at)}
      </span>
    );
  };

  const grouped = useMemo(() => {
    const dueNow = tasks.filter((t) => isDue(t) && t.status !== "done");
    const upcoming = tasks.filter((t) => !isDue(t) && t.status !== "done");
    const done = tasks.filter((t) => t.status === "done");
    return { dueNow, upcoming, done };
  }, [tasks]);

  const complete = async (task) => {
    try {
      await api.completeAssignableTask(task.id, {});
      toast.success(task.recurrence === "none" ? "Marked done" : "Completed · next occurrence scheduled");
      loadTasks();
    } catch (err) {
      toast.error("Failed to complete task");
    }
  };

  const updateStatus = async (task, status) => {
    try {
      await api.updateAssignableTask(task.id, { status });
      loadTasks();
    } catch (err) {
      toast.error("Failed to update task");
    }
  };

  const reassign = async (task, assignee_id) => {
    try {
      await api.updateAssignableTask(task.id, { assignee_id: assignee_id || null });
      loadTasks();
    } catch (err) {
      toast.error("Failed to reassign");
    }
  };

  const removeTask = async (task) => {
    if (!confirm(`Delete "${task.title}"?`)) return;
    try {
      await api.deleteAssignableTask(task.id);
      toast.success("Task deleted");
      loadTasks();
    } catch (err) {
      toast.error("Failed to delete");
    }
  };

  const renderTaskRow = (task) => (
    <div
      key={task.id}
      data-testid={`task-row-${task.id}`}
      className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3 sm:flex-row sm:items-start sm:gap-4"
    >
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-medium text-slate-100">{task.title}</div>
          <Badge variant="outline" className={`text-xs ${STATUS_TONE[task.status]}`}>
            {STATUS_LABEL[task.status]}
          </Badge>
          {task.recurrence !== "none" && (
            <Badge variant="outline" className="text-xs border-indigo-900 bg-indigo-950/40 text-indigo-200">
              {RECURRENCE_LABEL[task.recurrence]}
            </Badge>
          )}
        </div>
        {task.instructions && (
          <div className="mt-1 text-sm text-slate-400 whitespace-pre-wrap">{task.instructions}</div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1 text-slate-400">
            {workerIcon(task.assignee_id)} {workerName(task.assignee_id)}
          </span>
          {dueBadge(task)}
          {task.last_completed_at && (
            <span className="text-slate-500">
              Last completed {formatRelative(task.last_completed_at)}
            </span>
          )}
        </div>
        {task.notes && (
          <details className="mt-2 text-xs text-slate-400">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-300">Notes</summary>
            <pre className="mt-1 whitespace-pre-wrap text-slate-400">{task.notes}</pre>
          </details>
        )}
      </div>
      <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
        <Select value={task.assignee_id || ""} onValueChange={(v) => reassign(task, v)}>
          <SelectTrigger className="h-8 w-36 text-xs" data-testid={`task-assignee-select-${task.id}`}>
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            {workers.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          {task.status !== "done" && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-emerald-800 text-emerald-200 hover:bg-emerald-950/40"
              onClick={() => complete(task)}
              data-testid={`task-complete-btn-${task.id}`}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              {task.recurrence === "none" ? "Done" : "Complete"}
            </Button>
          )}
          {task.status === "open" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => updateStatus(task, "in_progress")}
              data-testid={`task-start-btn-${task.id}`}
            >
              Start
            </Button>
          )}
          {task.status === "done" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => updateStatus(task, "open")}
              data-testid={`task-reopen-btn-${task.id}`}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reopen
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-rose-300 hover:bg-rose-950/40"
            onClick={() => removeTask(task)}
            data-testid={`task-delete-btn-${task.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6" data-testid="tasks-page">
      <PageHeader
        kicker="Work queue"
        title="Tasks"
        description={activeClient ? `Assignable work for ${activeClient.name}. Assign to yourself, a hire, or Claude Cowork.` : "Pick a client to see their tasks."}
      >
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button data-testid="new-task-btn" disabled={!scope}>
              <Plus className="h-4 w-4 mr-1" /> New task
            </Button>
          </DialogTrigger>
          <NewTaskDialog
            clientId={scope}
            workers={workers}
            onClose={() => setShowCreate(false)}
            onCreated={() => { setShowCreate(false); loadTasks(); }}
            creating={creating}
            setCreating={setCreating}
          />
        </Dialog>
      </PageHeader>

      <Section testId="tasks-filters">
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="text-xs text-slate-500">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" data-testid="task-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Assignee</label>
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="w-48" data-testid="task-assignee-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.type === "agent" ? "🤖 " : "👤 "}{w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Section>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400" data-testid="tasks-loading">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading tasks…
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          title={scope ? "No tasks yet" : "Select a client"}
          description={scope ? 'Click "New task" to create one. Assign to Claude Cowork to have your MCP-connected agent pick it up.' : "Choose a client from the top-right selector to see and create tasks."}
          testId="tasks-empty"
        />
      ) : (
        <div className="space-y-6">
          {grouped.dueNow.length > 0 && (
            <Section title="Due now" testId="tasks-due">
              <div className="space-y-2">{grouped.dueNow.map(renderTaskRow)}</div>
            </Section>
          )}
          {grouped.upcoming.length > 0 && (
            <Section title="Upcoming" testId="tasks-upcoming">
              <div className="space-y-2">{grouped.upcoming.map(renderTaskRow)}</div>
            </Section>
          )}
          {grouped.done.length > 0 && (
            <Section title="Recently completed" testId="tasks-done">
              <div className="space-y-2">{grouped.done.map(renderTaskRow)}</div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function NewTaskDialog({ clientId, workers, onClose, onCreated, creating, setCreating }) {
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [assigneeId, setAssigneeId] = useState("claude-cowork");
  const [recurrence, setRecurrence] = useState("none");
  const [dueAt, setDueAt] = useState("");

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setCreating(true);
    try {
      const body = {
        client_id: clientId,
        title: title.trim(),
        instructions: instructions.trim(),
        assignee_id: assigneeId || null,
        recurrence,
      };
      if (dueAt) body.due_at = new Date(dueAt).toISOString();
      await api.createAssignableTask(body);
      toast.success("Task created");
      setTitle(""); setInstructions(""); setRecurrence("none"); setDueAt("");
      onCreated();
    } catch (err) {
      toast.error("Failed to create task");
    } finally {
      setCreating(false);
    }
  };

  return (
    <DialogContent data-testid="new-task-dialog">
      <DialogHeader>
        <DialogTitle>New task</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-slate-500">Title</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Review GSC anomalies for this week"
            data-testid="new-task-title"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Instructions</label>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="What should the assignee do? Include links, expected output, etc."
            rows={4}
            data-testid="new-task-instructions"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500">Assignee</label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger data-testid="new-task-assignee">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.type === "agent" ? "🤖 " : "👤 "}{w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Recurrence</label>
            <Select value={recurrence} onValueChange={setRecurrence}>
              <SelectTrigger data-testid="new-task-recurrence">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">One-off</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500">
            Due date {recurrence !== "none" && "(optional — defaults to today for recurring)"}
          </label>
          <Input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            data-testid="new-task-due"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} data-testid="new-task-cancel">Cancel</Button>
        <Button onClick={submit} disabled={creating || !title.trim()} data-testid="new-task-submit">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create task"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
