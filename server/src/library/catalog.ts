/**
 * Curated catalog of open datasets/models worth leveraging inside SET.
 * Every entry is verified against the public HuggingFace Hub API — no invented ids.
 */
export interface CatalogEntry {
  id: string; // huggingface dataset repo id
  name: string;
  category: string;
  description: string;
  /** what SET does with files from this dataset */
  importHint: string;
  stats?: { downloads?: number; likes?: number };
}

export const CATALOG: CatalogEntry[] = [
  {
    id: 'markov-ai/cad-1000-hours',
    name: 'CAD 1000 Hours',
    category: 'CAD & Engineering',
    description:
      '1,000 hours of expert CAD workflow recordings across AutoCAD, CATIA, NX, SolidWorks, Revit, SketchUp, STAAD and V-Ray — with task briefs (PDF), narrations (JSON), rubrics and input/output CAD files per session.',
    importHint:
      'Import task_desc PDFs, narrations and rubrics into a notebook to build a grounded CAD curriculum; attach output files as assets.',
    stats: { downloads: 9305, likes: 72 },
  },
  {
    id: 'allenai/objaverse',
    name: 'Objaverse',
    category: '3D Models',
    description:
      'A massive open corpus of 3D objects (GLB) with annotations — ideal raw material for the interactive 3D learning layer.',
    importHint: 'GLB files import straight into the 3D viewer (explode, parts, AI Q&A).',
  },
  {
    id: 'open-phi/textbooks',
    name: 'Fine-Tuning Textbooks',
    category: 'Learning Material',
    description: 'Synthetic STEM textbooks used for strong small-model training — chapters import as notebook sources.',
    importHint: 'Parquet rows convert to Markdown sources automatically.',
  },
  {
    id: 'wikimedia/wikipedia',
    name: 'Wikipedia',
    category: 'Knowledge',
    description: 'Official Wikipedia corpus snapshots — ground research notebooks in encyclopedic knowledge.',
    importHint: 'Parquet rows convert to Markdown sources automatically (pick a language config folder).',
  },
  {
    id: 'openai/gsm8k',
    name: 'GSM8K',
    category: 'Assessments',
    description: 'Grade-school math word problems with worked solutions — generate quizzes and drills.',
    importHint: 'Parquet rows convert to Markdown sources; ask the copilot to quiz you.',
  },
  {
    id: 'mlabonne/FineTome-100k',
    name: 'FineTome-100k',
    category: 'Learning Material',
    description: '100k high-quality conversational examples — useful for prompt and tutoring-style corpora.',
    importHint: 'Parquet rows convert to Markdown sources automatically.',
  },
];
