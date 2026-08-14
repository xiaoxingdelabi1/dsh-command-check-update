# DSH 更新检查器

在 Web UI 设置页面中检查 DeepSeek Harness 更新并升级。

## 功能

- **Web UI 设置页面**显示当前版本、最新版本和更新状态
- **一键检查更新**在设置页面中点击即可
- **一键升级**到最新版本
- **斜杠命令** `/check-update` 检查和 `/check-update upgrade` 升级

## 原理

插件注册了一个 `harness-update` 设置命名空间，它会出现在 Web UI 设置页面的"插件"部分。显示：

- 当前安装的 DSH 版本
- npm 上的最新可用版本
- 是否有可用更新
- 上次检查时间
- "检查更新"开关
- "升级"开关

## 用法

### 通过 Web UI 设置

1. 打开 DSH Web GUI 的设置页面
2. 找到"Harness Update"部分
3. 点击"检查更新"开关
4. 如果有更新，点击"升级"开关

### 通过斜杠命令

```
/check-update           # 检查更新
/check-update upgrade   # 升级到最新版本
```

## 安装

```yaml
# 在 cordis.patch.yml 里加一行
- insert:
    - id: check-update
      name: '@deepseek-ai/dsh-command-check-update'
```

## 许可证

MIT