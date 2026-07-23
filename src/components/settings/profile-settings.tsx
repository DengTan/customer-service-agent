'use client';

import { useState, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Camera, Upload, X, User as UserIcon, UserCog, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProfileSettingsProps {
  className?: string;
}

function getUserInitials(name: string): string {
  const chineseChars = name.match(/[\u4e00-\u9fa5]/g);
  if (chineseChars && chineseChars.length >= 1) {
    return chineseChars.slice(0, 2).join('');
  }
  const letters = name.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase();
  return letters || 'U';
}

export function ProfileSettings({ className }: ProfileSettingsProps) {
  const { user, refreshUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(user?.avatar || null);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type by magic bytes (defense in depth after MIME check)
    const allowedMagicBytes: Array<{ magic: number[]; offset: number; type: string }> = [
      { magic: [0xFF, 0xD8, 0xFF], offset: 0, type: 'image/jpeg' },
      { magic: [0x89, 0x50, 0x4E, 0x47], offset: 0, type: 'image/png' },
      { magic: [0x47, 0x49, 0x46, 0x38], offset: 0, type: 'image/gif' },
      { magic: [0x52, 0x49, 0x46, 0x46], offset: 0, type: 'image/webp' }, // RIFF....WEBP
    ];

    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('图片大小不能超过 2MB');
      return;
    }

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowedExts.includes(ext)) {
      toast.error('请上传 JPG、PNG、GIF 或 WebP 格式的图片');
      return;
    }

    if (!allowedMimes.includes(file.type)) {
      toast.error('请上传 JPG、PNG、GIF 或 WebP 格式的图片');
      return;
    }

    // Magic bytes verification
    const reader = new FileReader();
    reader.onload = async (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      const bytes = new Uint8Array(buffer.slice(0, 12));

      const isValidMagic = allowedMagicBytes.some(({ magic, offset, type }) => {
        if (bytes.length < offset + magic.length) return false;
        return magic.every((b, i) => bytes[offset + i] === b);
      });

      // For WebP, also check RIFF header (offset 0) and 'WEBP' at offset 8
      if (file.type === 'image/webp') {
        const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
        const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
        if (!riff || !webp) {
          toast.error('请上传 JPG、PNG、GIF 或 WebP 格式的图片');
          return;
        }
      } else if (!isValidMagic) {
        toast.error('请上传 JPG、PNG、GIF 或 WebP 格式的图片');
        return;
      }

      // Create preview
      setPreviewUrl(event.target?.result as string);

      // Upload file
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || '上传失败');
        }

        const data = await res.json();
        const avatarUrl = data.url;

        // Update user profile with new avatar using /api/users/me
        const updateRes = await fetch('/api/users/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar: avatarUrl }),
          credentials: 'include',
        });

        if (!updateRes.ok) {
          throw new Error('更新头像失败');
        }

        toast.success('头像上传成功');

        // Update local preview state immediately
        setPreviewUrl(avatarUrl);

        // Refresh user data
        await refreshUser?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '上传失败');
        // Restore preview URL to current user avatar on failure
        setPreviewUrl(user?.avatar || null);
      } finally {
        setUploading(false);
      }
    };
    reader.readAsArrayBuffer(file);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveAvatar = async () => {
    setPreviewUrl(null);
    
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: null }),
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('移除头像失败');
      }

      toast.success('头像已移除');
      await refreshUser?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '移除失败');
      setPreviewUrl(user?.avatar || null);
    }
  };

  if (!user) return null;

  return (
    <section className={cn('space-y-4', className)}>
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">个人设置</h2>
          <p className="text-xs text-muted-foreground mt-0.5">管理你的个人信息、头像和偏好设置</p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 text-xs text-muted-foreground">
          <UserIcon className="w-3 h-3" />
          <span className="relative flex items-center">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          </span>
          {user.role === 'admin' ? '管理员' : user.role === 'agent' ? '坐席' : '观察者'}
        </span>
      </div>

      {/* Avatar Section */}
      <div className="p-4 rounded-xl bg-card">
        <div className="flex items-center gap-2 mb-4">
          <Camera className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">头像</h3>
        </div>
        <div className="flex items-center gap-6">
          {/* Current Avatar Preview */}
          <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
            {previewUrl ? (
              <div className="relative">
                <img
                  src={previewUrl}
                  alt={user.name}
                  className="w-20 h-20 rounded-full object-cover border-2 border-border shadow-sm"
                />
                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera className="w-6 h-6 text-white" />
                </div>
              </div>
            ) : (
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-xl font-bold text-primary-foreground shadow-sm">
                {getUserInitials(user.name)}
              </div>
            )}
          </div>

          {/* Avatar Actions */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAvatarClick}
                disabled={uploading}
                className="gap-2 bg-muted hover:bg-muted/80"
              >
                {uploading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    上传中...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    {user.avatar ? '更换头像' : '上传头像'}
                  </>
                )}
              </Button>
              {user.avatar && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveAvatar}
                  disabled={uploading}
                  className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <X className="w-4 h-4" />
                  移除
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              支持 JPG、PNG、GIF、WebP 格式，最大 2MB
            </p>
          </div>

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </div>

      {/* Profile Info (Read-only) */}
      <div className="p-4 rounded-xl bg-card">
        <div className="flex items-center gap-2 mb-4">
          <UserCog className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">账户信息</h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground font-medium">姓名</label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border-none text-sm">
              <UserIcon className="w-4 h-4 text-muted-foreground shrink-0" />
              {user.name}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground font-medium">邮箱</label>
            <div className="group relative flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border-none text-sm cursor-default">
              <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="truncate">{user.email}</span>
              <span className="absolute left-0 top-full mt-1 px-3 py-2 bg-popover border border-border rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity whitespace-nowrap z-50 text-sm">
                {user.email}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground font-medium">角色</label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border-none text-sm">
              <span className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
                user.role === 'admin' ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" :
                user.role === 'agent' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
              )}>
                {user.role === 'admin' ? '管理员' : user.role === 'agent' ? '坐席' : '观察者'}
              </span>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
          <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground" />
          如需修改姓名或邮箱，请联系系统管理员
        </p>
      </div>
    </section>
  );
}

export default ProfileSettings;
