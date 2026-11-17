# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wyze69-sys/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wyze69-sys/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar built from one sealed DefiLlama snapshot. The program reads the snapshot, finds every protocol that records no token yet and is not a wrapped, staked or bridged product of one that trades, and ranks 198 of them by an implied launch value: TVL times a category multiple learned from the snapshot's own traded tokens (the median market-cap-to-TVL of the category, shrunk toward the global median; categories with fewer than three traded tokens use the global median), adjusted by seven-day TVL momentum and by how long the protocol has run with no token. The dashboard it ships is a static page with a sortable, filterable board, a detail view for every protocol showing the model on that protocol, and a concrete farm plan with costs and times for each row.

## Run it

```sh
node main.ts --input snapshot.json --output out
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=nynyk1yd&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
