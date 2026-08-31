-- Mastery map: decks can be scoped to a page (page-linked quizzes/flashcards
-- feed per-page mastery on the graph). Nullable — notebook-scoped decks are
-- unchanged; page decks use the page markdown as generation context.
ALTER TABLE decks ADD COLUMN IF NOT EXISTS page_id uuid REFERENCES pages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_decks_page ON decks (page_id) WHERE page_id IS NOT NULL;
