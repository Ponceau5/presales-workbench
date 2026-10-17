import { File, FileImage, FileSpreadsheet, FileText, Presentation, FileArchive, FileCode2 } from 'lucide-react';
export function FileFormatIcon({ format = '', name = '' }: {
    format?: string;
    name?: string;
}) {
    const ext = (format || name.split('.').pop() || '').toLowerCase();
    const Icon = /xlsx?|csv|ods/.test(ext) ? FileSpreadsheet : /png|jpe?g|gif|webp|svg/.test(ext) ? FileImage : /pptx?|odp/.test(ext) ? Presentation : /zip|rar|7z/.test(ext) ? FileArchive : /dwg|dxf|json|xml|md/.test(ext) ? FileCode2 : /pdf|docx?|rtf/.test(ext) ? FileText : File;
    const color = /xlsx?|csv/.test(ext) ? '#289b70' : /pdf/.test(ext) ? '#df626b' : /docx?/.test(ext) ? '#598ee4' : /pptx?/.test(ext) ? '#d88a45' : /png|jpe?g|gif|webp|svg/.test(ext) ? '#a07bd9' : '#8993a1';
    return <span className="file-format-icon" title={ext.toUpperCase() || '文件'} style={{ color }}><Icon size={17}/></span>;
}
