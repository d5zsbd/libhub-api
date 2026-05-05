export type ContentNode = 
  | { type: 'image', filename: string }
  | { type: 'paragraph', content?: Array<ContentNode> }
  | { type: 'text', text: string };

function _contentFilter(nodes: unknown[], images: Set<string>, text: string[], depth = 0): { content: ContentNode[]; hasContent: boolean } {
  if (depth > 10) {
    throw new Error('malicious post');
  }

  const content: ContentNode[] = [];
  let hasContent = false;

  for (const node of nodes) {
    if (typeof node !== 'object' || node === null || !('type' in node)) continue;

    switch (node.type) {
      case "image":
        if ('filename' in node && typeof node.filename === 'string') {
          hasContent = true;
          images.add(node.filename);
          content.push({ type: 'image', filename: node.filename });
        }
      break;
      case "paragraph":
        if ('content' in node && Array.isArray(node.content) && node.content.length !== 0) {
          const res = _contentFilter(node.content, images, text, depth + 1);

          if (res.content.length > 0) {
            content.push({ type: 'paragraph', content: res.content });
            if (!hasContent) hasContent = res.hasContent;
          } else {
            content.push({ type: 'paragraph' });
          }
        } else {
          content.push({ type: 'paragraph' }); // 没有content的paragraph就是换行
        }
      break;
      case "text":
        if ('text' in node && typeof node.text === 'string' && node.text.trim() !== '') {
          hasContent = true;
          text.push(node.text); // 清洗出纯文本用于全文搜索
          content.push({ type: 'text', text: node.text });
        }
      break;
    }
  }

  return { content, hasContent };
}

export function contentFilter(nodes: unknown[]) {
  const images = new Set<string>();
  const text: string[] = [];

  return {
    ..._contentFilter(nodes, images, text),
    images,
    text
  };
}