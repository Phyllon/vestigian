---
'vestigian': minor
---

A road audit over Itiner-e's conjectured roads, switched on from the overlay menu: which milestone and road records stand within 300 m of each, whether an end meets a surveyed segment, how steep its steepest 250 m stretch is on the terrain model — and which located milestones lie far from every road. Evidence, not a verdict: Itiner-e's own classification is unchanged. Two CSV downloads carry the ranked list. Run `pnpm db:migrate` and then `pnpm roads:audit`; `pnpm import:itinere-roads` now empties the audit and it must be run again.
