import type { JSX } from "react";

export function OpacLinks(input: {
  readonly book: {
    readonly sophiaOpacUrl: string;
    readonly utokyoOpacUrl: string;
  };
  readonly stopPropagation?: boolean;
}): JSX.Element | null {
  const links = [
    { label: "東大OPAC", url: input.book.utokyoOpacUrl.trim(), className: "button-link--utokyo" },
    { label: "上智OPAC", url: input.book.sophiaOpacUrl.trim(), className: "button-link--sophia" }
  ].filter((link) => link.url.length > 0);

  if (links.length === 0) {
    return null;
  }

  return (
    <div className="opac-links" aria-label="OPACリンク">
      {links.map((link) => (
        <a
          key={link.label}
          className={`button-link ${link.className}`}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          onClick={input.stopPropagation ? (event) => event.stopPropagation() : undefined}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
