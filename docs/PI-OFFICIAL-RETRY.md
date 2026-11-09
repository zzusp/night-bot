# Pi 官方原生重试配置

新的官方会话路径采用锁定 Pi 1.5 的 AgentSession 重试，应用不再维护另一套请求重试循环。

在 provider 中使用 `retry`：

```json
{
  "providers": {
    "example": {
      "retry": {
        "enabled": true,
        "maxRetries": 3,
        "baseDelayMs": 2000,
        "maxAgentDelayMs": 60000,
        "provider": {
          "maxRetries": 0,
          "maxRetryDelayMs": 60000
        }
      }
    }
  }
}
```

未指定值通过官方 `SettingsManager` 取得默认值。`maxRetries` 是初次请求之外的有限重试次数；设置 `enabled:false` 可关闭 AgentSession 重试。底层 SDK 的重试由 `provider.maxRetries` 单独控制；两层都开启时，一次会话尝试可能包含多次 HTTP 请求。可显式设为零，让预算只由 AgentSession 控制。

应用支持有限非负整数次数、正整数 Agent 退避时间和有界非负整数 provider 时间。时间不得超过 Node 定时器上限 2147483647ms。`provider.timeoutMs` 是底层 SDK 请求超时，不替代应用独立的 stream idle 预算。

## 与旧策略的明确差异

旧 `retryPolicy`（包括 `normal`、`always`、`retryableCodes`、`backoff`、jitter 和无限重试）不转换为 Pi 配置，出现时返回 `PI_RETRY_SETTINGS_MIGRATION_REQUIRED`。需要使用者明确选择新的 Pi 设置。

Pi 按官方错误分类判断是否重试，不使用 Night 旧 failure-code 白名单。限额/账单错误通常不重试；上下文溢出由官方 compaction 路径处理。退避采用官方有上限的指数退避，无旧 jitter，也不承诺旧 provider Retry-After 处理方式或旧重试事件序列。

`prepareRequest` 与 `finishTurn` 是官方生命周期挂钩，不是自建重试器入口。未知副作用仍由应用收据与授权闸保护：收据不明时阻止后续 provider/tool admission，保留原 unknown 状态供对账，不把重新请求模型当作重放外部操作的授权。回归测试覆盖成功效果后模型失败重试只执行一次，以及 unknown 在官方重试和后续输入中继续封锁。

模型 reasoning 未显式指定时，将 `thinkingLevel:undefined` 交给官方 `createAgentSession` 初始化与 clamp。显式用户或 profile 值须属于官方 `getSupportedThinkingLevels(model)` 返回的集合，不在应用中另写默认等级。
