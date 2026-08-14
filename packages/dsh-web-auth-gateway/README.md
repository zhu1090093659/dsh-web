# dsh-web-auth-gateway

DSH Web 登录网关。插件在独立端口提供首次管理员创建与登录页面，认证成功后将 HTTP 和 WebSocket 请求代理到当前 DSH Web 服务。

## 使用

安装后重启 `dsh web`，打开 `http://127.0.0.1:3090` 创建管理员账号。网关端口和会话有效期可以在「设置 > 插件配置 > Web UI 插件 > 登录网关」修改。

凭据只保存 scrypt 加盐哈希，文件位于 `~/.dsh/web-auth-gateway/credential.json`，权限为 `0600`。会话保存在内存中，重启 DSH 后需要重新登录。

DSH 原始端口必须仅绑定可信网络接口；否则客户端仍可绕过网关直接访问原始端口。

## 默认配置

```yaml
enabled: true
port: 3090
sessionTtlHours: 12
```

网关端口不能与 DSH Web 端口相同。
