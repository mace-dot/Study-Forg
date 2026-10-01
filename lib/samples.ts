import { randomUUID } from "node:crypto";
import type { Material, PackContent } from "./types";
export const sampleTexts = {
  finance: `Short selling and margin\nA short seller borrows shares and sells them, hoping to repurchase at a lower price. Short proceeds are held as collateral. Account equity equals short proceeds plus the investor's initial deposit, minus the current value of shares owed. Assume no interest, commissions, dividends, or borrow fees.\n\nMaintenance margin\nMargin ratio = equity / current short position value. If N shares were sold at P0 and initial margin is m0, total collateral C = N × P0 × (1 + m0). At maintenance margin mm, the trigger price P = C / [N × (1 + mm)]. A rising stock price reduces short account equity.\n\nPractice question\nShort 100 shares at $40 with 50% initial margin and 30% maintenance margin. At what price does the account reach the maintenance threshold?\n\nAdditional collateral\nAt a current price P, the additional deposit needed to restore required margin m is max(0, N × P × (1 + m) − C).\n\nPractice question\nShort 100 shares at $40 with a 50% initial deposit. The price rises to $50. How much must be deposited to restore 30% margin?`,
  reading: `Trade policy: tariffs and surplus\nA tariff is a tax on imports. In a small-country model, the importing country takes the world price as given. A tariff raises the domestic price above the world price by the tariff amount when imports continue.\n\nEconomic effects\nConsumers buy less at the higher domestic price. Domestic producers supply more. Imports shrink because they equal domestic demand minus domestic supply. Consumer surplus falls, producer surplus rises, and the government collects tariff revenue on remaining imports. The production and consumption distortions create deadweight loss.\n\nPractice question\nExplain why helping domestic producers through a tariff can still reduce total national welfare in the small-country model. Distinguish a transfer of surplus from deadweight loss.\n\nGraph interpretation\nLabel price on the vertical axis and quantity on the horizontal axis. Draw upward-sloping domestic supply and downward-sloping domestic demand. Mark the world price and the higher price with a tariff. Read quantities demanded and supplied at each price; imports are the horizontal gap between them.\n\nAssumptions\nThis introductory model assumes competitive markets, a small importing country, no externalities, and continuing imports. A large country can influence world prices, changing the welfare calculation.`,
};
export function sampleMaterial(
  courseId: string,
  type: "finance" | "reading",
): Material {
  const id = randomUUID(),
    filename =
      type === "finance"
        ? "Short-selling sample.txt"
        : "Trade-policy sample.txt";
  return {
    id,
    courseId,
    filename,
    kind: "practice exam",
    hash: "sample-" + type,
    sample: type,
    mime: "text/plain",
    sources: sampleTexts[type].split("\n\n").map((text, i) => ({
      id: randomUUID(),
      materialId: id,
      filename,
      location: `Paragraph ${i + 1}`,
      page: i + 1,
      text,
    })),
    warnings: [
      "Built-in demonstration material. This is not analysis of your own uploads.",
    ],
    createdAt: new Date().toISOString(),
  };
}
export function samplePack(material: Material): PackContent {
  const ref = material.sources.map((s) => s.id);
  if (material.sample === "finance")
    return {
      overview:
        "A short position earns money when a stock falls, but its margin becomes weaker as the stock rises. Learn to connect the position’s cash collateral, current liability, account equity, and margin ratio.",
      concepts: [
        {
          title: "Short selling: assets, liability, and equity",
          explanation:
            "You sell borrowed shares, then owe the same number of shares back. The sale proceeds plus your cash deposit form the collateral. The shares you owe are a liability valued at today’s price. Equity is what remains after subtracting that liability.",
          intuition:
            "If the stock rises, buying back the shares costs more. Your collateral does not automatically rise, so your equity shrinks.",
          prerequisites: ["Assets − liabilities = equity", "Margin ratios"],
          assumptions: [
            "No interest, dividends, commissions, or borrowing fees",
          ],
          formulas: [
            {
              expression: "C = N × P₀ × (1 + m₀)",
              variables:
                "C: total collateral; N: shares; P₀: short-sale price; m₀: initial margin as a decimal.",
              when: "Calculate the initial cash held in the account.",
            },
            {
              expression: "Equity = C − N × P",
              variables: "P: current share price.",
              when: "Find the investor’s remaining account equity.",
            },
          ],
          mistakes: [
            "Short proceeds are collateral, not profit.",
            "A stock price increase hurts a short seller.",
          ],
          sourceIds: [ref[0], ref[1]],
        },
        {
          title: "Maintenance threshold and additional deposits",
          explanation:
            "Maintenance margin compares account equity with the current value of shares owed. Solve the margin equation for the stock price to find the threshold. For a deposit question, calculate required collateral and subtract collateral already held.",
          intuition:
            "The stock can rise enough that the broker needs more of your money supporting the position.",
          prerequisites: ["Short account equity"],
          assumptions: ["Maintenance margin is expressed as a decimal"],
          formulas: [
            {
              expression: "P* = C / [N × (1 + mₘ)]",
              variables: "mₘ: maintenance margin; P*: threshold share price.",
              when: "Find the stock price where maintenance margin is reached.",
            },
            {
              expression: "Deposit = max(0, N × P × (1 + m) − C)",
              variables: "m: target margin after depositing.",
              when: "Restore a required margin ratio at a given stock price.",
            },
          ],
          mistakes: [
            "Using the original short-sale value as the maintenance denominator.",
            "Confusing the price threshold with the amount of cash to deposit.",
          ],
          sourceIds: [ref[1], ref[3]],
        },
      ],
      examples: [
        {
          title: "Find the maintenance price",
          problem:
            "Short 100 shares at $40; initial margin 50%; maintenance margin 30%.",
          steps: [
            "Initial proceeds = 100 × $40 = $4,000.",
            "Initial deposit = $4,000 × 0.50 = $2,000.",
            "Collateral C = $6,000.",
            "Threshold price = $6,000 / (100 × 1.30) = $46.1538.",
          ],
          interpretation:
            "At about $46.15, account equity is 30% of the current short liability.",
          sourceIds: [ref[2]],
        },
        {
          title: "Restore margin with a deposit",
          problem:
            "Using the same account, the stock rises to $50. Restore 30% margin.",
          steps: [
            "Current short liability = 100 × $50 = $5,000.",
            "Required equity = 0.30 × $5,000 = $1,500.",
            "Existing equity = $6,000 − $5,000 = $1,000.",
            "Deposit = $1,500 − $1,000 = $500.",
          ],
          interpretation:
            "The new $500 deposit restores equity to the required level.",
          sourceIds: [ref[4]],
        },
      ],
      quickReview: [
        "A rising price reduces short equity.",
        "Use current shares owed as the margin denominator.",
        "Initial collateral includes sale proceeds AND the initial deposit.",
        "Margin thresholds exclude fees in these examples.",
      ],
      patterns: [
        {
          title: "Short-sale maintenance price",
          skills: ["Account equity", "Solve for price"],
          steps: [
            "Compute collateral",
            "Write the maintenance equation",
            "Solve for price",
          ],
          traps: ["Wrong denominator"],
          evidence: [
            {
              sourceId: ref[2],
              question: material.sources[2].text
                .split("\n")
                .slice(1)
                .join("\n"),
            },
          ],
          suggested: false,
          template: "short-margin",
        },
        {
          title: "Short-sale additional collateral",
          skills: ["Target equity", "Additional deposit"],
          steps: [
            "Find required collateral",
            "Subtract existing collateral",
            "Floor at zero",
          ],
          traps: ["Confusing initial and maintenance margin"],
          evidence: [
            {
              sourceId: ref[4],
              question: material.sources[4].text
                .split("\n")
                .slice(1)
                .join("\n"),
            },
          ],
          suggested: false,
          template: "short-collateral",
        },
      ],
      warnings: [],
    };
  return {
    overview:
      "In the small-country tariff model, protection changes who receives surplus and also creates losses that no domestic group receives. Follow price changes through quantities and welfare.",
    concepts: [
      {
        title: "Tariffs, imports, and welfare",
        explanation:
          "A tariff raises the domestic price when imports continue. Consumers buy less, domestic firms produce more, and the gap between demand and domestic supply shrinks. Consumers lose surplus. Producers and the government receive part of that loss, while the remaining production and consumption distortions are deadweight loss.",
        intuition:
          "Some money changes hands within the country; some potential gains from trade disappear entirely. Those are different effects.",
        prerequisites: ["Supply and demand", "Consumer and producer surplus"],
        assumptions: [
          "Small importing country",
          "Competitive markets",
          "No externalities",
          "Imports continue after the tariff",
        ],
        formulas: [
          {
            expression: "Imports = Qd − Qs",
            variables:
              "Qd: domestic quantity demanded; Qs: domestic quantity supplied.",
            when: "Measure imports at the domestic price.",
          },
          {
            expression: "Tariff revenue = tariff per unit × imports",
            variables: "Use imports AFTER the tariff.",
            when: "Calculate government revenue.",
          },
        ],
        mistakes: [
          "Treating all consumer losses as deadweight loss.",
          "Using pre-tariff imports to calculate revenue.",
          "Applying the small-country result unchanged to a large country.",
        ],
        sourceIds: ref,
      },
    ],
    examples: [
      {
        title: "Read a tariff graph",
        problem: "How does a tariff change imports?",
        steps: [
          "Price goes on the vertical axis; quantity on the horizontal axis.",
          "Identify domestic demand and supply at the world price.",
          "Move to the higher price with the tariff.",
          "Demand falls and supply rises, so the horizontal import gap narrows.",
        ],
        interpretation:
          "The smaller import gap comes from both reduced consumption and increased domestic production.",
        sourceIds: [ref[3]],
      },
    ],
    quickReview: [
      "Consumer surplus falls; producer surplus rises.",
      "Government revenue is a transfer, not deadweight loss.",
      "Two distortions explain the welfare loss in the basic small-country model.",
    ],
    patterns: [
      {
        title: "Tariff welfare explanation",
        skills: ["Transfers versus efficiency losses", "Model assumptions"],
        steps: [
          "Describe the price change",
          "Identify winners and losers",
          "Separate transfers from deadweight loss",
        ],
        traps: ["Ignoring the small-country assumption"],
        evidence: [
          {
            sourceId: ref[2],
            question: material.sources[2].text.split("\n").slice(1).join("\n"),
          },
        ],
        suggested: false,
        template: "conceptual",
      },
    ],
    warnings: [],
  };
}
