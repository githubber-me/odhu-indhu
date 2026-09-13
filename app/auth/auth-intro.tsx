"use client";

import { useEffect, useState } from "react";

export function AuthIntro() {
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    try {
      setReturning(localStorage.getItem("odhu-indhu-has-entered") === "1");
    } catch {}
  }, []);

  if (returning) {
    return (
      <section className="authIntro authIntroReturning">
        <p className="eyebrow">YOUR PRIVATE STUDY LEDGER</p>
        <h1>
          Pick up where
          <br />
          <em>you left off.</em>
        </h1>
        <p>Your streak, sessions, and tomorrow’s recall are waiting.</p>
      </section>
    );
  }

  return (
    <section className="authIntro authIntroFirst">
      <p className="eyebrow authReveal authRevealOne">
        ಓದು ಇಂದು · YOUR STUDY COMPANION
      </p>
      <h1 className="authReveal authRevealTwo">
        Begin with
        <br />
        <em>one honest hour.</em>
      </h1>
      <p className="authReveal authRevealThree">
        Write down what you learned. Keep the day. Meet it again as recall.
      </p>
      <div
        className="authJourney authReveal authRevealFour"
        aria-label="Log your study, build your streak, then recall it"
      >
        <span>
          <b>01</b> LOG
        </span>
        <i aria-hidden="true" />
        <span>
          <b>02</b> STREAK
        </span>
        <i aria-hidden="true" />
        <span>
          <b>03</b> RECALL
        </span>
      </div>
    </section>
  );
}
