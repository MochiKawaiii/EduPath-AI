import type { FrequentlyAskedQuestion } from "./public-information";

export default function FaqAnswer({ faq }: { faq: FrequentlyAskedQuestion }) {
  return (
    <div className="pi-faq-answer">
      {faq.answer.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {faq.steps && <ol>{faq.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
      {faq.note && <p>{faq.note}</p>}
    </div>
  );
}
