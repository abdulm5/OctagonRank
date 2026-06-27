# UFC Fight Manual Annotations

This folder is a hand-curated overlay for context that UFCStats does not model
well. Join these rows back to the scraped fight data by `fight_id`.

Use `ufc_fight_manual_annotations.csv` as one row per fight that needs special
context. Keep source URLs filled in and set `review_status` to `needs_review`
when the row is based on a weaker or conflicting source.

Only add annotations when the context is high-confidence and source-backed. Do
not use this file to express a personal opinion about a close fight. A good row
should answer: what happened, which fighter was affected, where the source says
that happened, and why UFCStats alone cannot represent it.

Current flags:

- `controversial_decision`
- `injury_finish`
- `short_notice_fight`
- `weight_miss`
- `fighter_moving_divisions`
- `major_layoff`

`primary_category` can also hold narrower labels such as `weight_issue` when a
fight was moved because of weight trouble but did not have a normal official
weigh-in miss.

Current-division moves do not belong in this CSV. Use
`data/ranking_inputs/division_context.json` for active division changes such as
a ranked fighter leaving light heavyweight for heavyweight.
