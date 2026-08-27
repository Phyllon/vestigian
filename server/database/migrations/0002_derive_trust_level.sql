-- `users.trust_level` was denormalised state: a value derived entirely from
-- `role`, `trust_revoked` and `approved_contributions`, stored alongside them.
--
-- Nothing ever read it to make a decision. It was never indexed and never
-- appeared in a WHERE clause; it was written by two hand-transcribed SQL
-- expressions -- one in `applyRevision`, one in the trust endpoint -- each
-- carrying its own copy of the threshold that the governance model turns on,
-- somewhere no test could reach. `evaluateTrust` in
-- `shared/utils/authorization.ts` is now the only place that rule exists, and
-- the level is computed wherever it is displayed.
--
-- The three inputs are untouched, so this drops no information: every value
-- the column held can be recomputed from the row it sat in.

ALTER TABLE "users" DROP COLUMN IF EXISTS "trust_level";
