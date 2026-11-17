# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wyze69-sys/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wyze69-sys/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar built from one sealed DefiLlama snapshot. The program reads the snapshot, finds every protocol that records no token yet and is not a wrapped, staked or bridged product of one that trades, and ranks 198 of them by an implied launch value: TVL times a category multiple learned from the snapshot's own traded tokens (the median market-cap-to-TVL of the category, shrunk toward the global median in log space), times a size factor from a fitted TVL elasticity, a market-relative momentum factor, and a maturity factor for how long the protocol has run with no token. The model lives in `dashboard/model.js`, which the dashboard page itself loads, and it is validated in the open: a leave-one-out back-test over the 128 traded protocols ships in the dashboard's Method view. The dashboard is a static page with a sortable, filterable board, a watchlist grid covering all 40 watchlist protocols, a tab separating the traded protocols the model learned from, a detail view for every protocol showing its value waterfall and nearest traded peers, and a farm plan composed per protocol with costs and times.

## Run it

```sh
node main.ts --input snapshot.json --output out
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=nynyk1yd&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
