'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Search, Shield, Users, Edit3, Trash2, UserPlus,
  ToggleLeft, ToggleRight, Check, X, RotateCcw,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import type { User, UserRole, RolePermission, PermissionResource, PermissionAction } from '@/lib/types';
import { ROLE_LABELS, PERMISSION_RESOURCES, PERMISSION_ACTIONS } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { DEFAULT_PERMISSIONS } from '@/config/default-permissions';

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-primary/10 text-primary',
  agent: 'bg-emerald-200 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
  observer: 'bg-muted text-muted-foreground',
};

export default function TeamPage() {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'members' | 'permissions'>('members');
  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  // Modal states
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'agent' as UserRole });
  const [permRole, setPermRole] = useState<UserRole>('admin');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [createdUserPassword, setCreatedUserPassword] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>('');

  // Batch selection state
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [batchActionLoading, setBatchActionLoading] = useState(false);
  const [showBatchConfirmDialog, setShowBatchConfirmDialog] = useState(false);
  const [batchConfirmAction, setBatchConfirmAction] = useState<'enable' | 'disable' | 'delete' | null>(null);

  // Single action loading states
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{ id: string; name: string } | null>(null);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (roleFilter !== 'all') params.set('role', roleFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`/api/users?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.users) setUsers(data.users);
    } catch {
      toast.error('获取成员列表失败');
    } finally {
      setLoading(false);
    }
  }, [roleFilter, statusFilter, searchQuery]);

  // Fetch permissions
  const fetchPermissions = useCallback(async () => {
    try {
      const res = await fetch('/api/permissions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.permissions) setPermissions(data.permissions);
    } catch {
      toast.error('获取权限配置失败');
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (activeTab === 'permissions') {
      fetchPermissions();
    }
  }, [activeTab, fetchPermissions]);

  // Add user
  const handleAddUser = async () => {
    if (!newUser.name || !newUser.email) {
      toast.error('请填写姓名和邮箱');
      return;
    }
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.user) {
        toast.success('成员添加成功');
        setAddModalOpen(false);
        setNewUser({ name: '', email: '', role: 'agent' });
        // Show temporary password if available
        if (data.tempPassword) {
          setCreatedUserPassword(data.tempPassword);
          setShowPasswordModal(true);
        }
        fetchUsers();
      } else {
        toast.error(data.error || '添加失败');
      }
    } catch {
      toast.error('添加成员失败');
    }
  };

  // Open edit modal - initialize name field
  const openEditModal = (user: User) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditModalOpen(true);
  };

  // Update user
  const handleUpdateUser = async () => {
    if (!editingUser) return;
    if (!editName.trim()) {
      toast.error('姓名不能为空');
      return;
    }
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingUser.id, name: editName.trim(), role: editingUser.role }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.user) {
        toast.success('更新成功');
        setEditModalOpen(false);
        setEditingUser(null);
        setEditName('');
        fetchUsers();
      } else {
        toast.error(data.error || '更新失败');
      }
    } catch {
      toast.error('更新失败');
    }
  };

  // Delete user - show confirmation dialog
  const handleDeleteUser = (id: string) => {
    const user = users.find(u => u.id === id);
    if (user) {
      setUserToDelete({ id, name: user.name });
      setShowDeleteConfirmDialog(true);
    }
  };

  // Confirm delete user
  const confirmDeleteUser = async () => {
    if (!userToDelete) return;
    setDeletingUserId(userToDelete.id);
    try {
      const res = await fetch(`/api/users?id=${userToDelete.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('成员已删除');
        fetchUsers();
      } else {
        // Handle specific error codes
        if (data.code === 'LAST_ADMIN_PROTECTION') {
          toast.error(data.error || '无法删除最后一个管理员');
        } else if (data.code === 'SELF_DELETE_FORBIDDEN') {
          toast.error(data.error || '无法删除当前账号');
        } else {
          toast.error(data.error || '删除失败');
        }
      }
    } catch {
      toast.error('删除失败');
    } finally {
      setDeletingUserId(null);
      setShowDeleteConfirmDialog(false);
      setUserToDelete(null);
    }
  };

  // Toggle user status
  const handleToggleStatus = async (user: User) => {
    const newStatus = user.status === 'active' ? 'disabled' : 'active';
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, status: newStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.user) {
        toast.success(newStatus === 'active' ? '成员已启用' : '成员已禁用');
        fetchUsers();
      }
    } catch {
      toast.error('操作失败');
    }
  };

  // Toggle selection for a user
  const toggleUserSelection = (userId: string) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  // Toggle select all users
  const toggleSelectAll = () => {
    if (selectedUsers.size === users.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(users.map(u => u.id)));
    }
  };

  // Handle batch actions
  const handleBatchAction = (action: 'enable' | 'disable' | 'delete') => {
    if (selectedUsers.size === 0) {
      toast.error('请先选择要操作的成员');
      return;
    }
    setBatchConfirmAction(action);
    setShowBatchConfirmDialog(true);
  };

  // Confirm and execute batch action
  const executeBatchAction = async () => {
    if (!batchConfirmAction) return;
    setBatchActionLoading(true);
    try {
      let success = false;
      let affectedCount = 0;
      let protectedCount = 0;
      if (batchConfirmAction === 'delete') {
        // Filter out current user from deletion
        const idsToDelete = Array.from(selectedUsers).filter(id => id !== currentUser?.id);
        if (idsToDelete.length === 0) {
          toast.error('无法删除当前账号');
          setShowBatchConfirmDialog(false);
          setBatchActionLoading(false);
          return;
        }
        const res = await fetch(`/api/users?ids=${idsToDelete.join(',')}`, { method: 'DELETE' });
        const data = await res.json();
        success = res.ok && data.success;
        affectedCount = data.deleted ?? idsToDelete.length;
        protectedCount = data.protected?.length ?? 0;
        if (success) {
          if (protectedCount > 0) {
            toast.success(`已删除 ${affectedCount} 个成员，${protectedCount} 个受保护管理员无法删除`);
          } else {
            toast.success(`已删除 ${affectedCount} 个成员`);
          }
        }
      } else {
        const newStatus = batchConfirmAction === 'enable' ? 'active' : 'disabled';
        const res = await fetch('/api/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: Array.from(selectedUsers), status: newStatus }),
        });
        const data = await res.json();
        success = res.ok && data.success !== false;
        affectedCount = data.updated ?? selectedUsers.size;
        if (success) {
          toast.success(`${affectedCount} 个成员已${newStatus === 'active' ? '启用' : '禁用'}`);
        }
      }
      if (success) {
        setSelectedUsers(new Set());
        setShowBatchConfirmDialog(false);
        fetchUsers();
      } else {
        toast.error('操作部分失败，请刷新后重试');
      }
    } catch {
      toast.error('批量操作失败');
    } finally {
      setBatchActionLoading(false);
    }
  };

  // Toggle permission
  const handleTogglePermission = async (role: UserRole, resource: PermissionResource, action: PermissionAction) => {
    if (!role || !resource || !action) return;
    const current = getEffectivePermission(role, resource, action);
    const newValue = !current;

    // Optimistic update: update UI immediately
    setPermissions(prev => {
      const idx = prev.findIndex(p => p.role === role && p.resource === resource && p.action === action);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], allowed: newValue };
        return updated;
      }
      return prev;
    });

    try {
      const res = await fetch('/api/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permissions: [{ role, resource, action, allowed: newValue }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.permissions) {
        toast.success('权限已更新');
        // Re-fetch to ensure consistency
        fetchPermissions();
      }
    } catch {
      toast.error('更新权限失败');
      // Rollback on failure
      fetchPermissions();
    }
  };

  // Get effective permission (DB value or default)
  const getEffectivePermission = (role: UserRole, resource: PermissionResource, action: PermissionAction): boolean => {
    const perm = permissions.find(p => p.role === role && p.resource === resource && p.action === action);
    if (perm !== undefined) return perm.allowed;
    // Fall back to defaults when DB row doesn't exist
    return DEFAULT_PERMISSIONS[role]?.[resource]?.[action] ?? false;
  };

  // Note: User filtering is done server-side via fetchUsers(), so this is just an alias
  const filteredUsers = users;
  const activeUsers = users.filter(u => u.status === 'active');
  const onlineUsers = activeUsers.filter(u => {
    if (!u.last_active_at) return false;
    const diff = Date.now() - new Date(u.last_active_at).getTime();
    return diff < 30 * 60 * 1000; // 30 min
  });

  const formatLastActive = (date: string | null) => {
    if (!date) return '-';
    const diff = Date.now() - new Date(date).getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${Math.floor(diff / 86400000)} 天前`;
  };

  const clearFilters = () => {
    setSearchQuery('');
    setRoleFilter('all');
    setStatusFilter('all');
  };

  return (
    <div className="h-full flex flex-col page-transition">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-foreground">团队管理</h1>
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5 ml-4">
            <button
              onClick={() => setActiveTab('members')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'members'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              团队成员
            </button>
            {currentUser?.role === 'admin' && (
              <button
                onClick={() => setActiveTab('permissions')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'permissions'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                权限配置
              </button>
            )}
          </div>
        </div>
        {activeTab === 'members' && (
          <Button onClick={() => setAddModalOpen(true)} size="sm" className="gap-1.5">
            <UserPlus className="w-3.5 h-3.5" />
            添加成员
          </Button>
        )}
      </div>

      {/* Members Tab */}
      {activeTab === 'members' && (
        <>
          {/* Filters */}
          <div className="px-6 py-4 border-b border-border/50 bg-card/50 shrink-0">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="relative flex-1 max-w-sm min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="搜索姓名或邮箱..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                {(['all', 'admin', 'agent', 'observer'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRoleFilter(r)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      roleFilter === r
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {r === 'all' ? '全部角色' : ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                {(['all', 'active', 'disabled'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      statusFilter === s
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {s === 'all' ? '全部状态' : s === 'active' ? '启用' : '禁用'}
                  </button>
                ))}
              </div>
              {(searchQuery || roleFilter !== 'all' || statusFilter !== 'all') && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="w-3 h-3" />
                  清除筛选
                </button>
              )}
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/30 text-xs">
              <span className="text-muted-foreground">成员总数 <span className="font-semibold text-foreground">{filteredUsers.length}</span></span>
              <span className="text-muted-foreground">在线 <span className="font-semibold text-emerald-500">{onlineUsers.length}</span></span>
              <span className="text-muted-foreground">管理员 <span className="font-semibold text-foreground">{filteredUsers.filter(u => u.role === 'admin').length}</span></span>
              <span className="text-muted-foreground">坐席 <span className="font-semibold text-foreground">{filteredUsers.filter(u => u.role === 'agent').length}</span></span>
            </div>
          </div>

          {/* Batch Action Toolbar */}
          {selectedUsers.size > 0 && (
            <div className="px-6 py-3 bg-primary/5 border-b border-primary/20 shrink-0">
              <div className="flex items-center justify-between max-w-4xl">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-primary">
                    已选择 {selectedUsers.size} 个成员
                  </span>
                  <button
                    onClick={() => setSelectedUsers(new Set())}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    取消选择
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBatchAction('enable')}
                    className="h-8 text-xs"
                  >
                    批量启用
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBatchAction('disable')}
                    className="h-8 text-xs"
                  >
                    批量禁用
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleBatchAction('delete')}
                    className="h-8 text-xs"
                  >
                    批量删除
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-2 max-w-4xl">
              {/* Select All Header */}
              {!loading && users.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={selectedUsers.size === users.length && users.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-border"
                  />
                  <span>全选</span>
                </div>
              )}
              {loading ? (
                <div className="text-center py-12 text-muted-foreground text-sm">加载中...</div>
              ) : filteredUsers.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">暂无成员</div>
              ) : (
                filteredUsers.map((user) => (
                  <div key={user.id} className="border border-border rounded-xl bg-card overflow-hidden card-hover-lift">
                    <div className="flex items-center justify-between px-5 py-4">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedUsers.has(user.id)}
                          onChange={() => toggleUserSelection(user.id)}
                          className="w-4 h-4 rounded border-border"
                        />
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                          {user.name.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-medium text-foreground">{user.name}</span>
                            <Badge className={ROLE_COLORS[user.role]} variant="secondary">
                              {ROLE_LABELS[user.role]}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{user.email}</span>
                            <span className="flex items-center gap-1">
                              <div className={`w-1.5 h-1.5 rounded-full ${
                                user.status === 'disabled'
                                  ? 'bg-red-500'
                                  : onlineUsers.some(o => o.id === user.id)
                                    ? 'bg-emerald-500'
                                    : 'bg-muted-foreground/40'
                              }`} />
                              {user.status === 'disabled' ? '已禁用' : onlineUsers.some(o => o.id === user.id) ? '在线' : '离线'}
                            </span>
                            <span>最后活跃: {formatLastActive(user.last_active_at)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditModal(user)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="编辑成员"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleToggleStatus(user)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title={user.status === 'active' ? '禁用' : '启用'}
                        >
                          {user.status === 'active' ? (
                            <ToggleRight className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <ToggleLeft className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            currentUser?.id === user.id
                              ? 'text-muted-foreground/30 cursor-not-allowed'
                              : deletingUserId === user.id
                                ? 'text-muted-foreground/50 cursor-wait'
                                : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                          }`}
                          title={currentUser?.id === user.id ? '无法删除当前账号' : deletingUserId === user.id ? '删除中...' : '删除'}
                          disabled={currentUser?.id === user.id || deletingUserId === user.id}
                        >
                          {deletingUserId === user.id ? (
                            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                            </svg>
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Permissions Tab */}
      {activeTab === 'permissions' && (
        <>
          {/* Role selector */}
          <div className="px-6 py-4 border-b border-border/50 bg-card/50 shrink-0">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm text-muted-foreground">查看角色权限：</span>
              <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5">
                {(['admin', 'agent', 'observer'] as UserRole[]).map((role) => (
                  <button
                    key={role}
                    onClick={() => setPermRole(role)}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                      permRole === role
                        ? ROLE_COLORS[role] + ' shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {ROLE_LABELS[role]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground ml-2">
                {permRole === 'admin' && '管理员拥有所有权限'}
                {permRole === 'agent' && '坐席可查看对话、客户，部分编辑权限'}
                {permRole === 'observer' && '观察者仅可查看，无编辑和删除权限'}
              </p>
            </div>
          </div>

          {/* Permission matrix */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="border border-border rounded-xl bg-card overflow-hidden max-w-4xl">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3 w-48">资源</th>
                    {(Object.keys(PERMISSION_ACTIONS) as PermissionAction[]).map((action) => (
                      <th key={action} className="text-center text-xs font-medium text-muted-foreground px-4 py-3 w-32">
                        {PERMISSION_ACTIONS[action]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(PERMISSION_RESOURCES) as PermissionResource[]).map((resource, idx) => (
                    <tr key={resource} className={idx !== (Object.keys(PERMISSION_RESOURCES) as PermissionResource[]).length - 1 ? 'border-b border-border/50' : ''}>
                      <td className="text-sm font-medium text-foreground px-5 py-3.5">
                        {PERMISSION_RESOURCES[resource]}
                      </td>
                      {(Object.keys(PERMISSION_ACTIONS) as PermissionAction[]).map((action) => {
                        const perm = permissions.find(p => p.role === permRole && p.resource === resource && p.action === action);
                        const allowed = getEffectivePermission(permRole, resource, action);
                        return (
                          <td key={action} className="text-center px-4 py-3.5">
                            <button
                              onClick={() => handleTogglePermission(permRole, resource, action)}
                              className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all ${
                                allowed
                                  ? 'bg-primary/10 text-primary hover:bg-primary/20'
                                  : 'bg-muted/50 text-muted-foreground/40 hover:bg-muted hover:text-muted-foreground'
                              }`}
                            >
                              {allowed ? <Check className="w-4 h-4" /> : <X className="w-3.5 h-3.5" />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Add Member Modal */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">添加团队成员</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">姓名</label>
              <input
                type="text"
                placeholder="输入姓名"
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">邮箱</label>
              <input
                type="email"
                placeholder="输入邮箱"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">角色</label>
              <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v as UserRole })}>
                <SelectTrigger className="bg-muted border-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">管理员</SelectItem>
                  <SelectItem value="agent">坐席</SelectItem>
                  <SelectItem value="observer">观察者</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddModalOpen(false)} className="rounded-lg">取消</Button>
            <Button onClick={handleAddUser} className="rounded-lg">添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Member Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">编辑成员</DialogTitle>
          </DialogHeader>
          {editingUser && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-base font-semibold text-primary">
                  {(editName || editingUser.name || '?').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold text-foreground">{editingUser.email}</div>
                  <div className="text-xs text-muted-foreground">ID: {editingUser.id.slice(0, 8)}...</div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">姓名</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="输入姓名"
                  className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">角色</label>
                <Select
                  value={editingUser.role}
                  onValueChange={(v) => setEditingUser({ ...editingUser, role: v as UserRole })}
                >
                  <SelectTrigger className="bg-muted border-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">管理员</SelectItem>
                    <SelectItem value="agent">坐席</SelectItem>
                    <SelectItem value="observer">观察者</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setEditModalOpen(false); setEditingUser(null); setEditName(''); }} className="rounded-lg">取消</Button>
            <Button onClick={handleUpdateUser} className="rounded-lg">保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Modal - Show temporary password after user creation */}
      <Dialog open={showPasswordModal} onOpenChange={setShowPasswordModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-emerald-600">成员添加成功</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="text-amber-600 dark:text-amber-400 mt-0.5">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">请立即保存临时密码</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">该密码仅显示一次，请复制保存并告知成员</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">临时密码</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={createdUserPassword || ''}
                  className="flex-1 px-3 py-2.5 rounded-lg bg-muted border-none text-sm font-mono text-foreground"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(createdUserPassword || '');
                    toast.success('密码已复制到剪贴板');
                  }}
                  className="rounded-lg"
                >
                  复制
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowPasswordModal(false)} className="rounded-lg">我已保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Action Confirmation Dialog */}
      <Dialog open={showBatchConfirmDialog} onOpenChange={setShowBatchConfirmDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {batchConfirmAction === 'delete' && '确认批量删除'}
              {batchConfirmAction === 'enable' && '确认批量启用'}
              {batchConfirmAction === 'disable' && '确认批量禁用'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              {batchConfirmAction === 'delete' && `确定要删除选中的 ${selectedUsers.size} 个成员吗？此操作无法撤销。`}
              {batchConfirmAction === 'enable' && `确定要启用选中的 ${selectedUsers.size} 个成员吗？`}
              {batchConfirmAction === 'disable' && `确定要禁用选中的 ${selectedUsers.size} 个成员吗？`}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowBatchConfirmDialog(false)} className="rounded-lg" disabled={batchActionLoading}>
              取消
            </Button>
            <Button
              variant={batchConfirmAction === 'delete' ? 'destructive' : 'default'}
              onClick={executeBatchAction}
              className="rounded-lg"
              disabled={batchActionLoading}
            >
              {batchActionLoading ? '处理中...' : batchConfirmAction === 'delete' ? '确认删除' : batchConfirmAction === 'enable' ? '确认启用' : '确认禁用'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirmDialog} onOpenChange={setShowDeleteConfirmDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-destructive">确认删除成员</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              确定要删除成员 <span className="font-medium text-foreground">{userToDelete?.name}</span> 吗？此操作无法撤销。
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowDeleteConfirmDialog(false); setUserToDelete(null); }} className="rounded-lg" disabled={deletingUserId !== null}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDeleteUser} className="rounded-lg" disabled={deletingUserId !== null}>
              {deletingUserId !== null ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
