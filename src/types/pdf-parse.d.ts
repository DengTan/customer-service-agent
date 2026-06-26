declare module 'pdf-parse' {
  interface PDFData {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    text: string;
    version: string;
  }

  interface PDFOptions {
    pagerender?: (pageData: { getTextContent: () => Promise<unknown> }) => Promise<string>;
    max?: number;
    version?: string;
  }

  function pdfParse(data: Buffer | ArrayBuffer | Uint8Array, options?: PDFOptions): Promise<PDFData>;

  export = pdfParse;
}
