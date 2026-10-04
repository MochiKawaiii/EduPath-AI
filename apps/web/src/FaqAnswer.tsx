import { Fragment } from "react";
import type { FrequentlyAskedQuestion } from "./public-information";

// Renders e-mail addresses inside plain FAQ/policy text as mailto links.
export function withEmailLinks(text: string) {
  return text.split(/([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/).map((part, index) =>
    index % 2 ? <a key={index} href={`mailto:${part}`}>{part}</a> : <Fragment key={index}>{part}</Fragment>);
}

export default function FaqAnswer({ faq }: { faq: FrequentlyAskedQuestion }) {
  return (
    <div className="pi-faq-answer">
      {faq.answer.map((paragraph) => <p key={paragraph}>{withEmailLinks(paragraph)}</p>)}
      {faq.steps && <ol>{faq.steps.map((step) => <li key={step}>{withEmailLinks(step)}</li>)}</ol>}
      {faq.note && <p>{withEmailLinks(faq.note)}</p>}
    </div>
  );
}
