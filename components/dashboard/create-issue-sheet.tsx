"use client";

import React from "react";
import { X, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useForm, Controller } from "react-hook-form";

interface UserOption {
  name: string;
  displayName: string;
  avatarUrl: string | null;
}

interface CreateIssueFormData {
  summary: string;
  description: string;
  issueType: string;
  priority: string;
  aplikasi: string;
  modul: string;
  assignee: string;
  systemAnalyst: string;
}

interface CreateIssueSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateIssueSheet({ isOpen, onClose, onSuccess }: CreateIssueSheetProps) {
  const [isClosing, setIsClosing] = React.useState(false);
  const [users, setUsers] = React.useState<UserOption[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<CreateIssueFormData>({
    defaultValues: {
      issueType: "Task",
      priority: "Medium",
      aplikasi: "Cukai",
      modul: "",
      assignee: "",
      systemAnalyst: "",
    }
  });

  // Fetch users when opened
  React.useEffect(() => {
    if (isOpen && users.length === 0) {
      setIsLoadingUsers(true);
      fetch("/api/jira/users")
        .then((r) => r.json())
        .then((res) => {
          if (res.success) setUsers(res.data);
        })
        .catch(() => console.error("Failed to fetch users"))
        .finally(() => setIsLoadingUsers(false));
    }
    
    if (isOpen) {
      setSuccess(false);
      setError(null);
    }
  }, [isOpen]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      reset(); // Reset form on close
      onClose();
    }, 300); // match transition duration
  };

  const onSubmit = async (data: CreateIssueFormData) => {
    setIsSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch("/api/jira/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const resData = await response.json();

      if (!response.ok || !resData.success) {
        throw new Error(resData.error || "Gagal membuat tiket");
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess(); // triggers refresh
        handleClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen && !isClosing) return null;

  return (
    <>
      <div
        className={`fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[90] transition-opacity duration-300 ${
          isClosing ? "opacity-0" : "opacity-100"
        }`}
        onClick={handleClose}
      />
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-lg bg-white shadow-2xl z-[100] transform transition-transform duration-300 flex flex-col ${
          isClosing ? "translate-x-full" : "translate-x-0"
        }`}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex justify-between items-center px-6 py-5 border-b border-slate-100 bg-white">
          <div>
            <h2 className="text-xl font-bold text-[#071b3a] m-0">Create Issue</h2>
            <p className="text-xs text-slate-500 mt-1">Project: <span className="font-bold text-slate-700">BUGS26</span></p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 -mr-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-slate-50/50">
          <form id="create-issue-form" onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Success Alert */}
            {success && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-4 rounded-xl flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <div className="text-sm">Tiket berhasil dibuat! Merefresh data...</div>
              </div>
            )}

            {/* Error Alert */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="text-sm font-medium">{error}</div>
              </div>
            )}

            {/* Summary */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide">
                Summary (Judul) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                {...register("summary", { required: "Summary wajib diisi" })}
                placeholder="Contoh: [FE] Tombol simpan tidak berfungsi"
                className={`w-full h-11 px-3 rounded-xl border ${errors.summary ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'} focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm`}
              />
              {errors.summary && <span className="text-xs text-red-500">{errors.summary.message}</span>}
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide">
                Description
              </label>
              <textarea
                {...register("description")}
                placeholder="Jelaskan detail dari task/bug ini..."
                className="w-full h-28 p-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm resize-none custom-scrollbar"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Issue Type */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide">
                  Issue Type
                </label>
                <select
                  {...register("issueType")}
                  className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm"
                >
                  <option value="Task">Task</option>
                  <option value="Bug">Bug</option>
                </select>
              </div>

              {/* Priority */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide">
                  Priority
                </label>
                <select
                  {...register("priority")}
                  className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm"
                >
                  <option value="Highest">Highest</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                  <option value="Lowest">Lowest</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Aplikasi */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide">
                  Aplikasi
                </label>
                <select
                  {...register("aplikasi")}
                  className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm"
                >
                  <option value="Cukai">Cukai</option>
                  <option value="Non-Cukai">Non-Cukai</option>
                  <option value="Apps Manager">Apps Manager</option>
                  <option value="Barang Kiriman">Barang Kiriman</option>
                  <option value="Portal">Portal</option>
                </select>
              </div>

              {/* Modul */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide">
                  Modul
                </label>
                <input
                  type="text"
                  {...register("modul")}
                  placeholder="Contoh: Dokumen Pabean"
                  className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm"
                />
              </div>
            </div>

            {/* Assignee */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide flex justify-between">
                Assignee
                {isLoadingUsers && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
              </label>
              <select
                {...register("assignee")}
                className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm disabled:bg-slate-100"
                disabled={isLoadingUsers}
              >
                <option value="">-- Unassigned --</option>
                {users.map(u => (
                  <option key={u.name} value={u.name}>{u.displayName}</option>
                ))}
              </select>
            </div>

            {/* System Analyst */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wide flex justify-between">
                System Analyst (Tim SA)
              </label>
              <select
                {...register("systemAnalyst")}
                className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm disabled:bg-slate-100"
                disabled={isLoadingUsers}
              >
                <option value="">-- Tidak ada --</option>
                {users.map(u => (
                  <option key={u.name} value={u.name}>{u.displayName}</option>
                ))}
              </select>
            </div>
            
            <div className="pb-8"></div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-slate-100 bg-white flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="px-5 py-2.5 rounded-xl font-bold text-sm text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="create-issue-form"
            disabled={isSubmitting}
            className="px-6 py-2.5 rounded-xl font-bold text-sm text-white bg-[#0b66d8] hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2 shadow-sm"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSubmitting ? "Creating..." : "Create Issue"}
          </button>
        </div>
      </div>
    </>
  );
}
