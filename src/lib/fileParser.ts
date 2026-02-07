import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth";

// Disable worker — runs on main thread. Fine for ≤500KB files in a Chrome extension.
pdfjsLib.GlobalWorkerOptions.workerSrc = "";

// Supported file extensions
export const SUPPORTED_EXTENSIONS = new Set([
  // Text
  ".txt", ".md",
  // Data
  ".json", ".csv", ".xml", ".yaml", ".yml", ".toml",
  // Code
  ".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".rb", ".php",
  // Web
  ".html", ".css",
  // Shell
  ".sh", ".bash", ".zsh",
  // Documents
  ".pdf", ".docx",
]);

export const MAX_FILE_SIZE = 500 * 1024; // 500 KB per file
export const MAX_TOTAL_SIZE = 1024 * 1024; // 1 MB total

export const SENSITIVE_PATTERNS = [".env", ".pem", ".key", "credentials", "secret", "password"];

export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : "";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isSensitiveFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SENSITIVE_PATTERNS.some(pattern => lower.includes(pattern));
}

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => item.str)
      .join(" ");
    if (text.trim()) pages.push(text);
  }
  return pages.join("\n\n");
}

async function extractDocxText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

export async function readFileContent(file: File): Promise<string> {
  const ext = getFileExtension(file.name);
  if (ext === ".pdf") return extractPdfText(file);
  if (ext === ".docx") return extractDocxText(file);
  return file.text();
}

export function getFileTypeIcon(filename: string): { label: string; color: string } {
  const ext = getFileExtension(filename);
  switch (ext) {
    case ".pdf":
      return { label: "PDF", color: "#e94560" };
    case ".docx":
      return { label: "DOC", color: "#2b7cd3" };
    case ".json":
      return { label: "{ }", color: "#f0ad4e" };
    case ".csv":
      return { label: "CSV", color: "#5cb85c" };
    case ".md":
      return { label: "MD", color: "#888" };
    case ".py":
      return { label: "PY", color: "#3572A5" };
    case ".ts": case ".tsx":
      return { label: "TS", color: "#3178c6" };
    case ".js": case ".jsx":
      return { label: "JS", color: "#f7df1e" };
    case ".html":
      return { label: "HTML", color: "#e34c26" };
    case ".css":
      return { label: "CSS", color: "#563d7c" };
    default:
      return { label: "TXT", color: "#888" };
  }
}
