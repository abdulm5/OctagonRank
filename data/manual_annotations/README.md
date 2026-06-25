# UFC Fight Manual Annotations

This folder is a hand-curated overlay for context that UFCStats does not model
well. Join these rows back to the scraped fight data by `fight_id`.

Use `ufc_fight_manual_annotations.csv` as one row per fight that needs special
context. Keep source URLs filled in and set `review_status` to `needs_review`
when the row is based on a weaker or conflicting source.

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
