import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownRenderer } from './markdown-renderer';

describe('MarkdownRenderer', () => {
  describe('preprocessMarkdown (via component rendering)', () => {
    it('renders normal text unchanged', () => {
      const { container } = render(<MarkdownRenderer content="Hello, world!" />);
      expect(container.textContent?.trim()).toBe('Hello, world!');
    });

    it('renders well-formed **bold** as strong tag', () => {
      const { container } = render(<MarkdownRenderer content="This is **bold** text" />);
      const strong = container.querySelector('strong');
      expect(strong?.textContent).toBe('bold');
    });

    it('renders well-formed *italic* as em tag', () => {
      const { container } = render(<MarkdownRenderer content="This is *italic* text" />);
      const em = container.querySelector('em');
      expect(em).not.toBeNull();
      expect(em?.textContent).toBe('italic');
    });

    it('converts leading orphan ** to 【', () => {
      // Odd pair count: orphan ** at start → 【
      const { container } = render(<MarkdownRenderer content="**bold text without closing" />);
      expect(container.textContent?.trim()).toContain('【bold text without closing');
      expect(container.textContent).not.toContain('**');
    });

    it('converts trailing orphan ** to 】', () => {
      // Odd pair count: orphan ** at end → 】
      const { container } = render(<MarkdownRenderer content="bold text without opening**" />);
      expect(container.textContent?.trim()).toContain('bold text without opening】');
      expect(container.textContent).not.toContain('**');
    });

    it('handles mixed balanced pairs and orphan (odd total pairs)', () => {
      // 3 pairs: 1st=【 (orphan leading), 2nd=** (balanced), 3rd=】 (orphan trailing)
      const { container } = render(
        <MarkdownRenderer content="This is **bold** and this is **unclosed" />
      );
      // Both orphan markers should be present
      expect(container.textContent).toContain('【');
      expect(container.textContent).toContain('】');
    });

    it('converts orphan single * for extra safety', () => {
      const { container } = render(<MarkdownRenderer content="price is $10* extra" />);
      expect(container.textContent?.trim()).toContain('price is $10');
    });

    it('preserves well-formed *emphasis* italic', () => {
      const { container } = render(<MarkdownRenderer content="This is *emphasis* done" />);
      const em = container.querySelector('em');
      expect(em?.textContent).toBe('emphasis');
    });

    it('converts leading streaming fragment orphan **', () => {
      const { container } = render(<MarkdownRenderer content="**answer to the" />);
      expect(container.textContent?.trim()).toContain('【answer to the');
      expect(container.textContent).not.toContain('**');
    });

    it('converts trailing streaming fragment orphan **', () => {
      const { container } = render(<MarkdownRenderer content="answer to the**" />);
      expect(container.textContent?.trim()).toContain('answer to the】');
      expect(container.textContent).not.toContain('**');
    });

    it('renders numbered lists', () => {
      const { container } = render(
        <MarkdownRenderer content="1. First\n2. Second\n3. Third" />
      );
      expect(container.textContent?.trim()).toContain('First');
      expect(container.textContent?.trim()).toContain('Second');
      expect(container.textContent?.trim()).toContain('Third');
    });

    it('renders blockquotes', () => {
      const { container } = render(
        <MarkdownRenderer content="> This is a quote" />
      );
      const blockquote = container.querySelector('blockquote');
      expect(blockquote).not.toBeNull();
      expect(blockquote?.textContent).toContain('This is a quote');
    });

    it('renders inline code', () => {
      const { container } = render(
        <MarkdownRenderer content="Use `code` here" />
      );
      const code = container.querySelector('code');
      expect(code).not.toBeNull();
      expect(code?.textContent).toBe('code');
    });

    it('renders links', () => {
      const { container } = render(
        <MarkdownRenderer content="Visit [our site](https://example.com)" />
      );
      const anchor = container.querySelector('a');
      expect(anchor).not.toBeNull();
      expect(anchor?.getAttribute('href')).toBe('https://example.com');
      expect(anchor?.textContent).toBe('our site');
    });

    it('does not crash on empty string', () => {
      const { container } = render(<MarkdownRenderer content="" />);
      expect(container.textContent).toBe('');
    });

    it('does not crash on whitespace only', () => {
      const { container } = render(<MarkdownRenderer content="   \n\n   " />);
      expect(container.textContent).toBeTruthy();
    });

    it('does not crash on special characters', () => {
      const special = '!@#$%^&*()+-=[]{}|;\':",./<>?';
      const { container } = render(<MarkdownRenderer content={special} />);
      expect(container.textContent).toBeTruthy();
    });

    it('applies className prop correctly', () => {
      const { container } = render(
        <MarkdownRenderer content="test" className="custom-class" />
      );
      const div = container.querySelector('div');
      expect(div?.className).toContain('custom-class');
    });

    it('handles multiple ** pairs (even total = balanced)', () => {
      // Even pairs: all preserved → marked handles correctly
      const { container } = render(<MarkdownRenderer content="**a****b**" />);
      const strongs = container.querySelectorAll('strong');
      expect(strongs.length).toBe(1);
    });

    it('handles reference-style Chinese bracket markers from LLM', () => {
      const { container } = render(
        <MarkdownRenderer content="Answer here\n【引用来源：知识库文章】" />
      );
      expect(container.textContent).toContain('【引用来源：知识库文章】');
    });
  });
});
