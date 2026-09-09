# Longbridge Developers Documentation

Longbridge Developers provides programmatic quote trading interfaces for investors with research and development capabilities and assists them to build trading or quote strategy analysis tools based on their own investment strategies. The functions fall into the following categories:

- **Trading** - Create, amend, cancel orders, query today's/past orders and transaction details, etc.
- **Quotes** - Real-time quotes, acquisition of historical quotes, etc.
- **Portfolio** - Real-time query of the account assets, positions, funds
- **Real-time subscription** - Provides real-time quotes and push notifications for order status changes

## Interface Type

Longbridge provides diversified access methods such as HTTP / WebSockets interfaces for accessing the underlying services and SDK (Python / C++, etc.) encapsulated in the upper layer, allowing flexible choices.

## How to Enable OpenAPI

1. Log in to the [Longbridge App](https://longbridge.com/download) to complete the account opening process;

2. Log in to the [longbridge.com](https://longbridge.com) and enter the developer platform, complete the developer verification (OpenAPI permission application), and obtain a token.

## Quote Coverage

<table>
    <thead>
    <tr>
        <th>Market</th>
        <th>Symbol</th>
    </tr>
    </thead>
    <tr>
        <td width="160" rowspan="2">HK Market</td>
        <td>Securities (including equities, ETFs, Warrants, CBBCs)</td>
    </tr>
    <tr>
        <td>Hang Seng Index</td>
    </tr>
    <tr>
        <td rowspan="3">US Market</td>
        <td>Securities (including stocks, ETFs)</td>
    </tr>
    <tr>
        <td>Nasdsaq Index</td>
    </tr>
    <tr>
        <td>OPRA Options</td>
    </tr>
    <tr>
        <td rowspan="2">CN Market</td>
        <td>Securities (including stocks, ETFs)</td>
    </tr>
    <tr>
        <td>Index</td>
    </tr>
</table>

## Trading

Supported trading functions include:

| Market    | Stock and ETF | Warrant & CBBC | Options |
| --------- | ------------- | -------------- | ------- |
| HK Market | ✓             | ✓              |         |
| US Market | ✓             | ✓              | ✓       |

## Rate Limit {#rate-limit}

| Category  | Limitation                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quote API | <ul><li>One account can only create one long link and subscribe to a maximum of 500 symbols at the same time</li><li>No more than 10 calls in a 1-second interval and the number of concurrent requests should not exceed 5</li></ul> |
| Trade API | <ul><li>No more than 30 calls in a 30-second interval, and the interval between two calls should not be less than 0.02 seconds</li></ul>                                                                                              |

:::success

The [OpenAPI SDK](https://open.longbridge.com/sdk) has done effective frequency control internally:

- Quote: The methods under `QuoteContext` will be actively controlled by the SDK according to the server's rate limit. When the request is too fast, the SDK will automatically delay the request. Therefore, you do not need to implement the frequency control details separately.
- Trade: The methods under `TradeContext` are not limited by the SDK. Due to the special nature of the trading order placement scenario, this is left to the user to handle.

:::

## Pricing {#pricing}

Longbridge does not charge any additional fees for activating or using interface services. You only need to open a Longbridge Integrated A/C and get OpenAPI service permissions to use it for free. For actual transaction fees, please contact the brokerage firm where you have opened your securities account.

## Other

The OpenAPI services are provided by Longbridge and the applicable affiliates (subject to the agreement).
openapi-trade.longbridge.com


## SDK 

### 项目内容语言

本项目的基本面、资讯和市场内容接口使用当前用户的有效 `app_language`：`zh` 对应 SDK `Language.ZH_CN`，`en` 对应 `Language.EN`，优先于 `LONGBRIDGE_LANGUAGE`。在配置页保存语言后，公司资料、估值说明等由长桥提供本地化的内容会按该语言请求；原始公告、新闻等不保证有翻译版本。

内容 Context 和 Insights 结果缓存按凭据与语言隔离，切换语言后不会复用另一语言的结果。行情 `QuoteContext` 继续按凭据共享，避免语言切换建立额外的行情长连接；其公告原文和行情字段保留原有 SDK 语言行为。SDK 的环境变量及旧版 `.env` 凭据回退仍兼容，应用业务配置仍以 SQLite 为准。

- [Overview](https://open.longbridge.com/docs.md)

## Docs

- [Getting Started](https://open.longbridge.com/docs/getting-started.md)
- [llm](https://open.longbridge.com/docs/llm.md)
- [MCP](https://open.longbridge.com/docs/mcp.md)
- [Get Socket OTP (One time password)](https://open.longbridge.com/docs/socket-token-api.md)
- [API Reference](https://open.longbridge.com/docs/api.md)

## Content

- [List My Published Topics](https://open.longbridge.com/docs/content/my-topics.md)
- [Create Topic Reply](https://open.longbridge.com/docs/content/create-topic-reply.md)
- [Security News](https://open.longbridge.com/docs/content/news.md)
- [Get Community Topics by Symbol](https://open.longbridge.com/docs/content/topics.md)
- [Get Topic Detail](https://open.longbridge.com/docs/content/topic-detail.md)
- [List Topic Replies](https://open.longbridge.com/docs/content/topic-replies.md)
- [Create Topic](https://open.longbridge.com/docs/content/create-topic.md)

## Cli

- [Release Notes](https://open.longbridge.com/docs/cli/release-notes.md)
- [Installation](https://open.longbridge.com/docs/cli/install.md)
- [Longbridge CLI](https://open.longbridge.com/docs/cli/index.md)
- [tui](https://open.longbridge.com/docs/cli/tui.md)

## Orders

- [order](https://open.longbridge.com/docs/cli/orders/order.md)
- [margin-ratio](https://open.longbridge.com/docs/cli/orders/margin-ratio.md)
- [max-qty](https://open.longbridge.com/docs/cli/orders/max-qty.md)
- [exchange-rate](https://open.longbridge.com/docs/cli/orders/exchange-rate.md)

## Content

- [news](https://open.longbridge.com/docs/cli/content/news.md)
- [filing](https://open.longbridge.com/docs/cli/content/filing.md)
- [topic](https://open.longbridge.com/docs/cli/content/topic.md)

## Watchlist

- [watchlist](https://open.longbridge.com/docs/cli/watchlist/watchlist.md)
- [sharelist](https://open.longbridge.com/docs/cli/watchlist/sharelist.md)

## Derivatives

- [option](https://open.longbridge.com/docs/cli/derivatives/option.md)
- [warrant](https://open.longbridge.com/docs/cli/derivatives/warrant.md)
- [short-positions](https://open.longbridge.com/docs/cli/derivatives/short-positions.md)

## Research

- [shareholder](https://open.longbridge.com/docs/cli/research/shareholder.md)
- [insider-trades](https://open.longbridge.com/docs/cli/research/insider-trades.md)
- [investors](https://open.longbridge.com/docs/cli/research/investors.md)

## Fundamentals

- [forecast-eps](https://open.longbridge.com/docs/cli/fundamentals/forecast-eps.md)
- [executive](https://open.longbridge.com/docs/cli/fundamentals/executive.md)
- [consensus](https://open.longbridge.com/docs/cli/fundamentals/consensus.md)
- [operating](https://open.longbridge.com/docs/cli/fundamentals/operating.md)
- [invest-relation](https://open.longbridge.com/docs/cli/fundamentals/invest-relation.md)
- [industry-valuation](https://open.longbridge.com/docs/cli/fundamentals/industry-valuation.md)
- [valuation](https://open.longbridge.com/docs/cli/fundamentals/valuation.md)
- [dividend](https://open.longbridge.com/docs/cli/fundamentals/dividend.md)
- [finance-calendar](https://open.longbridge.com/docs/cli/fundamentals/finance-calendar.md)
- [financial-report](https://open.longbridge.com/docs/cli/fundamentals/financial-report.md)
- [company](https://open.longbridge.com/docs/cli/fundamentals/company.md)
- [institution-rating](https://open.longbridge.com/docs/cli/fundamentals/institution-rating.md)
- [corp-action](https://open.longbridge.com/docs/cli/fundamentals/corp-action.md)

## Market-data

- [brokers](https://open.longbridge.com/docs/cli/market-data/brokers.md)
- [subscriptions](https://open.longbridge.com/docs/cli/market-data/subscriptions.md)
- [market-temp](https://open.longbridge.com/docs/cli/market-data/market-temp.md)
- [calc-index](https://open.longbridge.com/docs/cli/market-data/calc-index.md)
- [kline](https://open.longbridge.com/docs/cli/market-data/kline.md)
- [broker-holding](https://open.longbridge.com/docs/cli/market-data/broker-holding.md)
- [quote](https://open.longbridge.com/docs/cli/market-data/quote.md)
- [intraday](https://open.longbridge.com/docs/cli/market-data/intraday.md)
- [anomaly](https://open.longbridge.com/docs/cli/market-data/anomaly.md)
- [trading](https://open.longbridge.com/docs/cli/market-data/trading.md)
- [capital](https://open.longbridge.com/docs/cli/market-data/capital.md)
- [trades](https://open.longbridge.com/docs/cli/market-data/trades.md)
- [security-list](https://open.longbridge.com/docs/cli/market-data/security-list.md)
- [market-status](https://open.longbridge.com/docs/cli/market-data/market-status.md)
- [ah-premium](https://open.longbridge.com/docs/cli/market-data/ah-premium.md)
- [participants](https://open.longbridge.com/docs/cli/market-data/participants.md)
- [depth](https://open.longbridge.com/docs/cli/market-data/depth.md)
- [trade-stats](https://open.longbridge.com/docs/cli/market-data/trade-stats.md)
- [static](https://open.longbridge.com/docs/cli/market-data/static.md)
- [constituent](https://open.longbridge.com/docs/cli/market-data/constituent.md)

## Account

- [fund-positions](https://open.longbridge.com/docs/cli/account/fund-positions.md)
- [profit-analysis](https://open.longbridge.com/docs/cli/account/profit-analysis.md)
- [portfolio](https://open.longbridge.com/docs/cli/account/portfolio.md)
- [cash-flow](https://open.longbridge.com/docs/cli/account/cash-flow.md)
- [dca](https://open.longbridge.com/docs/cli/account/dca.md)
- [assets](https://open.longbridge.com/docs/cli/account/assets.md)
- [positions](https://open.longbridge.com/docs/cli/account/positions.md)
- [alert](https://open.longbridge.com/docs/cli/account/alert.md)
- [fund-holder](https://open.longbridge.com/docs/cli/account/fund-holder.md)
- [statement](https://open.longbridge.com/docs/cli/account/statement.md)

## Qa

- [General](https://open.longbridge.com/docs/qa/general.md)
- [Trade](https://open.longbridge.com/docs/qa/trade.md)
- [Quote Releated](https://open.longbridge.com/docs/qa/broker.md)

## Socket

- [Data Commands](https://open.longbridge.com/docs/socket/biz-command.md)
- [Subscribe Real-Time Market Data](https://open.longbridge.com/docs/socket/subscribe_quote.md)
- [Access differences between WebSocket and TCP](https://open.longbridge.com/docs/socket/diff_ws_tcp.md)
- [Control commands](https://open.longbridge.com/docs/socket/control-command.md)
- [Endpoints](https://open.longbridge.com/docs/socket/hosts.md)
- [Subscribe Real-Time Trading Data](https://open.longbridge.com/docs/socket/subscribe_trade.md)

## Protocol

- [Parse Response Packet](https://open.longbridge.com/docs/socket/protocol/response.md)
- [Parse Push Packet](https://open.longbridge.com/docs/socket/protocol/push.md)
- [Communication Model](https://open.longbridge.com/docs/socket/protocol/connect.md)
- [Protocol Overview](https://open.longbridge.com/docs/socket/protocol/overview.md)
- [Parse Header of Packet](https://open.longbridge.com/docs/socket/protocol/header.md)
- [Parse Handshake](https://open.longbridge.com/docs/socket/protocol/handshake.md)
- [Parse Request Packet](https://open.longbridge.com/docs/socket/protocol/request.md)

## Quote

- [Definition](https://open.longbridge.com/docs/quote/objects.md)
- [Overview](https://open.longbridge.com/docs/quote/overview.md)

## Push

- [Push Real-time Quote](https://open.longbridge.com/docs/quote/push/quote.md)
- [Push Real-time Trades](https://open.longbridge.com/docs/quote/push/trade.md)
- [Push Real-time Brokers](https://open.longbridge.com/docs/quote/push/broker.md)
- [Push Real-time Depth](https://open.longbridge.com/docs/quote/push/depth.md)

## Pull

- [Security Brokers](https://open.longbridge.com/docs/quote/pull/brokers.md)
- [Option Chain Expiry Date List](https://open.longbridge.com/docs/quote/pull/optionchain-date.md)
- [Security History Candlesticks](https://open.longbridge.com/docs/quote/pull/history-candlestick.md)
- [Calculate Indexes Of Securities](https://open.longbridge.com/docs/quote/pull/calc-index.md)
- [Security Candlesticks](https://open.longbridge.com/docs/quote/pull/candlestick.md)
- [Warrant Issuer IDs](https://open.longbridge.com/docs/quote/pull/issuer.md)
- [Security Filings](https://open.longbridge.com/docs/quote/pull/filings.md)
- [Real-time Quotes Of Securities](https://open.longbridge.com/docs/quote/pull/quote.md)
- [Security Intraday](https://open.longbridge.com/docs/quote/pull/intraday.md)
- [Security Capital Distribution](https://open.longbridge.com/docs/quote/pull/capital-distribution.md)
- [Historical Market Temperature](https://open.longbridge.com/docs/quote/pull/history_market_temperature.md)
- [Option Chain By Date](https://open.longbridge.com/docs/quote/pull/optionchain-date-strike.md)
- [Security Capital Flow Intraday](https://open.longbridge.com/docs/quote/pull/capital-flow-intraday.md)
- [Real-time Quotes of Option](https://open.longbridge.com/docs/quote/pull/option-quote.md)
- [Market Trading Days](https://open.longbridge.com/docs/quote/pull/trade-day.md)
- [Security Trades](https://open.longbridge.com/docs/quote/pull/trade.md)
- [Security Depth](https://open.longbridge.com/docs/quote/pull/depth.md)
- [Trading Session of The Day](https://open.longbridge.com/docs/quote/pull/trade-session.md)
- [Broker IDs](https://open.longbridge.com/docs/quote/pull/broker-ids.md)
- [Real-time Quotes of Warrant](https://open.longbridge.com/docs/quote/pull/warrant-quote.md)
- [Basic Information of Securities](https://open.longbridge.com/docs/quote/pull/static.md)
- [Current Market Temperature](https://open.longbridge.com/docs/quote/pull/market_temperature.md)
- [Warrant Filter](https://open.longbridge.com/docs/quote/pull/warrant-filter.md)

## Individual

- [Watchlist Group](https://open.longbridge.com/docs/quote/individual/watchlist_groups.md)
- [Create Watchlist Group](https://open.longbridge.com/docs/quote/individual/watchlist_create_group.md)
- [Delete Watchlist Group](https://open.longbridge.com/docs/quote/individual/watchlist_delete_group.md)
- [Update Watchlist Group](https://open.longbridge.com/docs/quote/individual/watchlist_update_group.md)

## Subscribe

- [Subscribe Quote](https://open.longbridge.com/docs/quote/subscribe/subscribe.md)
- [Unsubscribe Quote](https://open.longbridge.com/docs/quote/subscribe/unsubscribe.md)
- [Subscription Information](https://open.longbridge.com/docs/quote/subscribe/subscription.md)

## Security

- [Retrieve the List of Securities](https://open.longbridge.com/docs/quote/security/security_list.md)

## Trade

- [Definition](https://open.longbridge.com/docs/trade/trade-definition.md)
- [Trade Push](https://open.longbridge.com/docs/trade/trade-push.md)
- [Overview](https://open.longbridge.com/docs/trade/trade-overview.md)

## Execution

- [Get Today Executions](https://open.longbridge.com/docs/trade/execution/today_executions.md)
- [Get History Executions](https://open.longbridge.com/docs/trade/execution/history_executions.md)

## Order

- [Get History Order](https://open.longbridge.com/docs/trade/order/history_orders.md)
- [Withdraw Order](https://open.longbridge.com/docs/trade/order/withdraw.md)
- [Order Details](https://open.longbridge.com/docs/trade/order/order_detail.md)
- [Replace Order](https://open.longbridge.com/docs/trade/order/replace.md)
- [Submit Order](https://open.longbridge.com/docs/trade/order/submit.md)
- [Estimate Maximum Purchase Quantity](https://open.longbridge.com/docs/trade/order/estimate_available_buy_limit.md)
- [Get Today Order](https://open.longbridge.com/docs/trade/order/today_orders.md)

## Asset

- [Get Stock Positions](https://open.longbridge.com/docs/trade/asset/stock.md)
- [Get Cash Flow](https://open.longbridge.com/docs/trade/asset/cashflow.md)
- [Get Fund Positions](https://open.longbridge.com/docs/trade/asset/fund.md)
- [Get Account Assets](https://open.longbridge.com/docs/trade/asset/account.md)
- [Get Margin Ratio](https://open.longbridge.com/docs/trade/asset/margin_ratio.md)

## Skill

- [Skill](https://open.longbridge.com/skill/index.md)

## Install

- [Skill Installation Guide](https://open.longbridge.com/skill/install/index.md)

## Stocks Assistant OAuth 2.0 接入

配置页的长桥连接支持 `API Key` 和 `OAuth 2.0` 两种方式。默认保持原有 API Key
行为；选择 OAuth 后点击授权，应用按系统/个人配置作用域动态注册独立客户端，
通过 SDK `OAuthBuilder(...).build_async()` 完成授权，再用 `Config.from_oauth()`
接入已有行情、财报、新闻、自选股等 service。无需手工填写 client_id，也不会复用
其他用户或其他应用的 SDK 授权。管理员连接保存在系统配置，普通用户连接仅覆盖
其个人配置；已有个人 API Key 配置仍使用原认证方式。

- 授权接口：`POST /api/v1/config/longbridge/oauth/start`；查询状态：
  `GET /api/v1/config/longbridge/oauth/status`；取消/断开：
  `DELETE /api/v1/config/longbridge/oauth/disconnect`。均要求登录及 `config:read`，
  系统配置写入额外遵循管理员权限。Token、授权码和原始 SDK 错误不会返回前端。
- SDK 4.1 回调固定使用 `http://localhost:<随机端口>/callback`，仅监听后端本机。
  浏览器与后端需运行在同一台电脑；远程部署需自行转发显示的回调端口，不能直接
  使用远程浏览器本地地址完成授权。授权等待最多 5 分钟，最终以配置页状态为准。
  SSH 部署可在授权页显示端口后使用
  `ssh -N -L <回调端口>:127.0.0.1:<回调端口> user@server`，保持转发后再打开授权
  链接；两端端口需相同，且应在授权超时前完成。
- SDK 自动刷新并将 Token 缓存在
  `~/.longbridge/openapi/tokens/<应用独立注册的 client_id>`。Python 4.1 未开放
  自定义 TokenStorage，这是应用 SQLite 加密配置以外的 **SDK 文件缓存例外**。
  应用创建目录为 `0700`、Token 文件为 `0600`，验证客户端绑定并拒绝符号链接；
  SDK 覆写刷新时保留权限。SQLite 仅保存认证方式和客户端 ID，不保存 Token。
  重启后按配置中的 ID 恢复该缓存；失效且无法刷新时，普通行情请求不会隐式
  发起浏览器授权，而会提示回配置页重新连接。
- 断开会清理本地凭据和运行缓存，并保持 OAuth 模式未连接状态；原 API Key 值
  保留，可手工切回。此操作不等同于长桥服务端撤销授权，如需撤销，应在长桥账户
  中管理应用授权。
  取消仍在等待的授权仅清理本次尝试，保留之前有效的 API Key / OAuth 连接。
- 已核对 SDK v4.1.0 的 state 校验与 300 秒超时实现；该版本原生浏览器流程未
  实现 PKCE。原生 Future 直接取消会遗留监听器，因此应用通过独占的本机回调
  发送拒绝信号，让 SDK 正常结束并清理监听器。

依据：[官方认证文档](https://open.longbridge.com/zh-CN/docs/getting-started#认证方式)、
[v4.1.0 OAuthBuilder](https://github.com/longbridge/openapi/blob/v4.1.0/rust/crates/oauth/src/builder.rs)、
[v4.1.0 Token 缓存](https://github.com/longbridge/openapi/blob/v4.1.0/rust/crates/oauth/src/token.rs)、
[v4.1.0 本机回调](https://github.com/longbridge/openapi/blob/v4.1.0/rust/crates/oauth/src/callback.rs)。
