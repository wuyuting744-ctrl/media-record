# 影视文学记录

账号登录使用现有 Supabase 项目。调酒网站账号可直接登录，两站业务资料使用独立表。

记录、封面、自定义题材、陪看选项、画册排序和看板布局绑定账号。退出后页面清空私人资料。新账号初始为空；「导入本机旧记录」仅在主动确认后导入原浏览器数据，不删除旧数据。

保存需网络连接；失败恢复已保存资料，并保留记录编辑表单。多设备同时修改由 revision 检查拒绝旧版本覆盖，可刷新后再编辑。每份账号资料的保存请求上限 25MB。

`supabase/schema.sql` 已在现有项目执行。RLS 限制 authenticated 只能读取/插入/更新自身 user_id；匿名用户无权限。浏览器只含公开 Publishable key，登录会话由 Supabase SDK 管理。

注册需验证邮箱；忘记密码通过邮件回到本站。Supabase Auth 的 Redirect URLs 包含 https://wuyuting744-ctrl.github.io/media-record/ 。

保存性能：仅更新变化的 records、images、genres、companions 或 layout 字段，不发送未变化字段。文字编辑不上传封面；数据库只返回 revision 和 updated_at。records 当前仍是完整文本列表，images 仅变化时发送完整封面映射。用原64条备份测得文字保存请求约34KB，旧请求约5.7MB。使用 user_id 和 revision 条件更新，返回空行时提示版本冲突。
