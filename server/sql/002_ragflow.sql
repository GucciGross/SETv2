-- Optional RAGFlow integration: bind a notebook to a RAGFlow dataset
ALTER TABLE notebooks ADD COLUMN IF NOT EXISTS ragflow_dataset_id text;
