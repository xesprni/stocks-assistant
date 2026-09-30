# 资产收盘快照

后端启动后每分钟检查一次已启用且有持仓读取权限的账户，为有持仓或现金设置的市场记录快照。
不依赖浏览器是否打开，也不依赖 Agent 的 `scheduler_enabled` 开关。

| 市场 | 时区 | 正常收盘 | 半日市收盘 | 首次采集 |
| --- | --- | --- | --- | --- |
| 美股 | America/New_York | 16:00 | 13:00 | 收盘后 5 分钟 |
| 港股 | Asia/Hong_Kong | 16:10（含收市竞价） | 12:10 | 收盘后 5 分钟 |
| A 股 | Asia/Shanghai | 15:00 | 由交易日历确认 | 收盘后 5 分钟 |

`ZoneInfo` 自动处理美股夏令时；是否交易日、是否半日市通过现有 Longbridge MarketService 的
`get_trading_days` 查询，按账户、凭据和交易日缓存。假日和周末不按简单的周一至周五规则猜测。
时间依据：[NYSE](https://www.nyse.com/markets/hours-calendars)、
[HKEX](https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market?sc_lang=en)、
[SSE](https://english.sse.com.cn/start/trading/schedule/)；
交易日依据：[Longbridge 交易日接口](https://open.longbridge.com/docs/quote/pull/trade-day)。

## 估值及保存口径

- 资产总额 = 本地现金 + 本地持股数量 × 当个交易日未复权的常规时段日线收盘价。
- 日线通过已有 `get_history_candlesticks` 获取，校验返回日期，不使用盘后价、成本回退或旧日行情。
  数量、金额用 Decimal 计算并以字符串保存。缺少持股数量或任何收盘价时，本次不写入，下轮重试。
- 行情采集期间持仓或现金变化，写入事务会校验估值输入并拒绝跨版本结果，下次重新采集。
- 在 `workspace_dir/portfolio/portfolio.db` 的 `portfolio_asset_snapshots` 表持久化，以
  `user_id + market + date` 为唯一键。重复运行、并发 worker 和重启都不覆盖已有记录。
  新表由现有幂等 schema 初始化创建，不修改持仓及交易流水。
- `scheduled_at` 记录交易所收盘时间，`captured_at` 记录采集轮次时间（UTC）。
  `date` 是市场当地交易日，因此美股收盘不会被记到香港时间的次日。
- 估值使用实际采集时的本地持仓和现金。服务在同一交易日收盘后恢复，会尝试补采当日；
  跨日不根据当前持仓伪造停机期间的历史快照。收盘时后端应保持运行并配置可用行情凭据。

## 前端与兼容

`GET /api/v1/portfolio?market=...` 新增 `asset_snapshots`，按交易日升序返回该账户该市场最近
2200 个快照。持仓页在加载或刷新持仓时更新图表；即使当前实时行情不可用，已保存历史仍可展示。

页面访问不再自动写入浏览器快照。旧版 localStorage 数据保留在原处，但不并入收盘曲线，
因为旧记录是页面访问时的盘中估值，不能标成收盘价。资产变化包含资金进出和持仓调整，不等同收益率。

## 回归验证

`tests/test_portfolio_snapshots.py` 覆盖三个市场、夏令时、半日市、休市、账户隔离、重复及重启、
缺失或陈旧行情、数量不完整、并发持仓变化、旧数据库初始化和后台服务退出。
前端 workspace 浏览器回归验证服务端历史展示、当前行情缺失时保留曲线，以及不覆盖旧浏览器数据。
