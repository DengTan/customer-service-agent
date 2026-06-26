'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Plus, Search, Shield, Users, Edit3, Trash2, UserPlus,
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

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-primary/10 text-primary',
  agent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  observer: 'bg-muted text-muted-foreground',
};

export default function TeamPage() {
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
        fetchUsers();
      } else {
        toast.error(data.error || '添加失败');
      }
    } catch {
      toast.error('添加成员失败');
    }
  };

  // Update user
  const handleUpdateUser = async (updates: Partial<User>) => {
    if (!editingUser) return;
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingUser.id, ...updates }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.user) {
        toast.success('更新成功');
        setEditModalOpen(false);
        setEditingUser(null);
        fetchUsers();
      } else {
        toast.error(data.error || '更新失败');
      }
    } catch {
      toast.error('更新失败');
    }
  };

  // Delete user
  const handleDeleteUser = async (id: string) => {
    if (!confirm('确定要删除该成员吗？')) return;
    try {
      const res = await fetch(`/api/users?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        toast.success('成员已删除');
        fetchUsers();
      } else {
        toast.error(data.error || '删除失败');
      }
    } catch {
      toast.error('删除失败');
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

  // Toggle permission
  const handleTogglePermission = async (perm: RolePermission) => {
    try {
      const res = await fetch('/api/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permissions: [{ ...perm, allowed: !perm.allowed }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.permissions) {
        fetchPermissions();
      }
    } catch {
      toast.error('更新权限失败');
    }
  };

  // Get permission for role/resource/action
  const getPermission = (role: UserRole, resource: PermissionResource, action: PermissionAction): RolePermission | undefined => {
    return permissions.find(p => p.role === role && p.resource === resource && p.action === action);
  };

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

          {/* List */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-2 max-w-4xl">
              {loading ? (
                <div className="text-center py-12 text-muted-foreground text-sm">加载中...</div>
              ) : filteredUsers.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">暂无成员</div>
              ) : (
                filteredUsers.map((user) => (
                  <div key={user.id} className="border border-border rounded-xl bg-card overflow-hidden card-hover-lift">
                    <div className="flex items-center justify-between px-5 py-4">
                      <div className="flex items-center gap-3">
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
                          onClick={() => { setEditingUser(user); setEditModalOpen(true); }}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="编辑角色"
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
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
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
                        const perm = getPermission(permRole, resource, action);
                        const allowed = perm?.allowed ?? false;
                        return (
                          <td key={action} className="text-center px-4 py-3.5">
                            <button
                              onClick={() => perm && handleTogglePermission(perm)}
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

      {/* Edit Role Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">编辑成员角色</DialogTitle>
          </DialogHeader>
          {editingUser && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-base font-semibold text-primary">
                  {editingUser.name.charAt(0)}
                </div>
                <div>
                  <div className="font-semibold text-foreground">{editingUser.name}</div>
                  <div className="text-sm text-muted-foreground">{editingUser.email}</div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">角色</label>
                <Select
                  defaultValue={editingUser.role}
                  onValueChange={(v) => handleUpdateUser({ role: v as UserRole })}
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
            <Button variant="ghost" onClick={() => { setEditModalOpen(false); setEditingUser(null); }} className="rounded-lg">关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
