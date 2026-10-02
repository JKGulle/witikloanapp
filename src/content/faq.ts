import { LOAN_LIMITS, annualRateFor, formatMoney, loanQuote } from '../lib/loan.ts'
import { PENALTY_PER_DAY, PENALTY_TOTAL_COST_CAP } from '../lib/penalty.ts'
import { ID_TYPES } from '../lib/kyc.ts'
import { IDLE_LIMIT_MS, IDLE_WARNING_MS } from '../auth/idle.ts'

/** A paragraph (string) or a bulleted list (string[]). Plain text keeps answers searchable. */
export type FaqBlock = string | string[]

export interface FaqItem {
  q: string
  a: FaqBlock[]
}

export interface FaqSection {
  id: string
  title: string
  items: FaqItem[]
}

// Examples are computed with the app's own loan math, so they always match the calculator.
const peso = (n: number) => formatMoney(n)
const pesoWhole = (n: number) => formatMoney(n, true)
const EXAMPLE = 20_000
const short = loanQuote(EXAMPLE, 6)
const year = loanQuote(EXAMPLE, 12)
const long = loanQuote(EXAMPLE, 24)
const idleMinutes = IDLE_LIMIT_MS / 60_000
const warnSeconds = IDLE_WARNING_MS / 1000
const penalty = pesoWhole(PENALTY_PER_DAY)

export const FAQ: FaqSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    items: [
      {
        q: 'What is Witik Loan?',
        a: [
          'Witik Loan is a personal loan app. You apply on your phone or computer, track your application, see your full repayment schedule, and follow every payment in one place.',
        ],
      },
      {
        q: 'How do I create an account?',
        a: [
          'Tap Create account on the sign-in screen and enter your full name, email address and a password of at least 8 characters.',
          'We send a confirmation link to your email. Open it to activate your account, then sign in.',
        ],
      },
      {
        q: 'What do I need before I can apply?',
        a: [
          [
            'A confirmed Witik account.',
            'A complete profile: full name, mobile number and monthly income (Profile tab).',
            'A valid government ID and a selfie for identity verification. You can apply before verifying, but a loan cannot be approved until your identity is verified.',
          ],
        ],
      },
      {
        q: 'Can I use Witik on my phone?',
        a: [
          'Yes. Witik works in any modern browser on phones, tablets and computers, and as an Android app. The layout adapts to your screen.',
        ],
      },
    ],
  },
  {
    id: 'applying',
    title: 'Applying for a loan',
    items: [
      {
        q: 'How much can I borrow, and for how long?',
        a: [
          `You can borrow from ${pesoWhole(LOAN_LIMITS.minAmount)} to ${pesoWhole(LOAN_LIMITS.maxAmount)}, in steps of ${pesoWhole(LOAN_LIMITS.amountStep)}, for ${LOAN_LIMITS.minTerm} to ${LOAN_LIMITS.maxTerm} months.`,
        ],
      },
      {
        q: 'What can I use the loan for?',
        a: [
          'Choose the purpose that fits best when you apply: Education, Medical, Business, Home improvement, Emergency, Debt consolidation or Other.',
        ],
      },
      {
        q: 'How do I apply?',
        a: [
          [
            'Open the Apply tab.',
            'Move the sliders to choose your amount and term. Your monthly payment, interest rate, total interest and total payable update instantly.',
            'Pick a purpose, read and tick the confirmation box, then tap Submit application.',
          ],
          'Your application appears under Loans with the status Pending review.',
        ],
      },
      {
        q: 'What happens after I apply?',
        a: [
          [
            'Pending review — our team has received your application.',
            'Credit investigation — a Witik credit investigator may contact you to confirm your employment, income and address.',
            'Approved or Rejected — if rejected, the reason is shown on your loan page.',
            'Active — the money has been released to you and your repayment schedule starts.',
            'Paid off — every installment and any penalties are fully paid.',
          ],
          'Applications are usually reviewed within 24 hours, but checks can take longer if we can’t reach you or your documents need another look.',
        ],
      },
      {
        q: 'Can I cancel my application?',
        a: [
          'Yes, while it is still Pending review. Open the loan under Loans and tap Cancel application. Once a decision has been made it can no longer be cancelled.',
        ],
      },
      {
        q: 'Why did I get an affordability warning?',
        a: [
          'If the monthly payment would be more than 40% of the monthly income in your profile, the app warns you. You can still apply, but a smaller amount or a longer term is easier to repay and more likely to be approved.',
        ],
      },
    ],
  },
  {
    id: 'interest',
    title: 'Interest & fees',
    items: [
      {
        q: 'What interest rate will I pay?',
        a: [
          'The rate depends only on the term you choose:',
          [
            `Up to 6 months: ${annualRateFor(6)}% per year`,
            `7 to 12 months: ${annualRateFor(12)}% per year`,
            `13 to ${LOAN_LIMITS.maxTerm} months: ${annualRateFor(LOAN_LIMITS.maxTerm)}% per year`,
          ],
          'The rate is fixed for the whole loan and is shown before you submit.',
        ],
      },
      {
        q: 'How is the interest calculated?',
        a: [
          'Witik uses a fixed monthly payment (amortization). Each month, interest is charged only on the balance you still owe — one-twelfth of the yearly rate. As your balance goes down, more of each payment goes to the principal.',
          'Your last payment can differ from the others by a few centavos because of rounding.',
        ],
      },
      {
        q: 'Can you show me an example?',
        a: [
          `Borrowing ${pesoWhole(EXAMPLE)}:`,
          [
            `6 months at ${short.annualRate}%: ${peso(short.payment)} a month, ${peso(short.totalInterest)} total interest, ${peso(short.totalPayable)} in total`,
            `12 months at ${year.annualRate}%: ${peso(year.payment)} a month, ${peso(year.totalInterest)} total interest, ${peso(year.totalPayable)} in total`,
            `24 months at ${long.annualRate}%: ${peso(long.payment)} a month, ${peso(long.totalInterest)} total interest, ${peso(long.totalPayable)} in total`,
          ],
          'A longer term lowers your monthly payment but you pay more interest overall.',
        ],
      },
      {
        q: 'Are there other fees?',
        a: [
          `There are no application or processing fees in the app. The only extra charge is the late payment penalty of ${penalty} per day (see Penalties).`,
        ],
      },
    ],
  },
  {
    id: 'repayment',
    title: 'Repayment',
    items: [
      {
        q: 'When are my payments due?',
        a: [
          'Once a month, on the same day of the month your loan was released. If that day doesn’t exist in a month (for example the 31st), it falls on the last day of that month.',
          'Your full schedule — due dates, amounts, interest and remaining balance — is on your loan page under Loans.',
        ],
      },
      {
        q: 'How do I pay?',
        a: [
          'Follow the payment instructions Witik gives you when your loan is released, and keep the reference number of every payment.',
          'A Witik cashier records each payment against your loan and gives you the reference. It then appears under Payments on your loan page, and your progress bar and balance update.',
        ],
      },
      {
        q: 'Can I pay more than my monthly amount, or pay early?',
        a: [
          'Yes. Any extra amount is applied to your next installments in order. Your schedule and the total interest stay the same.',
        ],
      },
      {
        q: 'How do I know how much I still owe?',
        a: [
          'Your Home screen shows your outstanding balance (including any unpaid penalties), your next due date and amount. Each loan page shows what you’ve paid and what’s left.',
        ],
      },
    ],
  },
  {
    id: 'penalties',
    title: 'Late payments & penalties',
    items: [
      {
        q: 'What happens if I pay late?',
        a: [
          `A late penalty of ${penalty} is charged for every day an installment stays unpaid after its due date. The first penalty day is the day after the due date (Philippine time).`,
          'Penalties stop as soon as everything overdue — the late installments and the penalties — is paid.',
        ],
      },
      {
        q: 'Can you show me an example?',
        a: [
          `If an installment is due on 10 February and you pay it on 20 February, you are 10 days late, so the penalty is 10 × ${penalty} = ${pesoWhole(PENALTY_PER_DAY * 10)}.`,
        ],
      },
      {
        q: 'How are my payments applied when I have penalties?',
        a: [
          'Payments go to unpaid penalties first, then to your installments.',
          `Example: you are 3 days late (${pesoWhole(PENALTY_PER_DAY * 3)} in penalties) and pay only your usual ${peso(year.payment)}. ${pesoWhole(PENALTY_PER_DAY * 3)} clears the penalty and the rest goes to the installment, which is now ${pesoWhole(PENALTY_PER_DAY * 3)} short — so it is still overdue and penalties continue.`,
          'To stop penalties, pay the full "Pay now" amount shown on your loan page.',
        ],
      },
      {
        q: 'Is there a limit to penalties?',
        a: [
          `Yes. Your interest and penalties together can never be more than ${PENALTY_TOTAL_COST_CAP * 100}% of the amount you borrowed. Once that limit is reached, penalties stop increasing — but the loan is still overdue until it’s paid.`,
          `Example: borrowing ${pesoWhole(EXAMPLE)} for 12 months has ${peso(year.totalInterest)} in interest, so penalties can never exceed ${peso(EXAMPLE * PENALTY_TOTAL_COST_CAP - year.totalInterest)}. Your limit is shown on your loan page.`,
        ],
      },
      {
        q: 'How do I know if I’m overdue?',
        a: [
          [
            'A red banner on your Home screen tells you which loan is overdue, by how many days, and how much to pay now.',
            'On the loan page, overdue installments are marked in red with "!" and a breakdown shows penalties charged, paid and still due.',
          ],
        ],
      },
      {
        q: 'Do penalties disappear once I catch up?',
        a: [
          'No. Penalties already charged stay in your loan history even after you catch up. A loan is only marked Paid off when every installment and every penalty has been paid.',
        ],
      },
    ],
  },
  {
    id: 'verification',
    title: 'Identity verification (KYC)',
    items: [
      {
        q: 'What is KYC and why do you need it?',
        a: [
          'KYC means “Know Your Customer”. Lenders are required to confirm that you are who you say you are. It protects you from someone borrowing in your name, and Witik cannot approve a loan until your identity is verified.',
        ],
      },
      {
        q: 'Which IDs are accepted?',
        a: [ID_TYPES.map((t) => t.label)],
      },
      {
        q: 'How do I verify my identity?',
        a: [
          [
            'Go to Profile → Identity verification.',
            'Choose your ID type.',
            'Add a photo of the front of your ID (the photo page for a passport) and, if it has details on the back, the back too.',
            'Take a selfie holding your ID next to your face.',
            'Tap Submit for verification. Your status changes to Pending review.',
          ],
        ],
      },
      {
        q: 'What do the verification statuses mean?',
        a: [
          [
            'Not verified — you haven’t submitted documents yet.',
            'Pending review — we’re checking your documents. You can still replace them.',
            'Verified — you’re all set.',
            'Rejected — the reason is shown in Identity verification. Upload new photos to try again.',
          ],
        ],
      },
      {
        q: 'Who can see my ID and selfie?',
        a: [
          'Only you, Witik administrators, and the credit investigator assigned to your application. Photos are stored privately and are never public. They’re resized on your device before upload, which also removes most hidden photo data such as location.',
        ],
      },
    ],
  },
  {
    id: 'security',
    title: 'Account & security',
    items: [
      {
        q: 'Why was I signed out?',
        a: [
          [
            `After ${idleMinutes} minutes without any taps, clicks, typing or scrolling, you’re signed out automatically. A “Still there?” message gives you ${warnSeconds} seconds to stay signed in first.`,
            'Closing the app or browser tab signs you out.',
            `Leaving the app in the background for more than ${idleMinutes} minutes also signs you out when you come back.`,
          ],
          'This protects your financial information if your device is lost or shared.',
        ],
      },
      {
        q: 'Why do I need to sign in again in a new tab?',
        a: [
          'For security, each browser tab keeps its own sign-in, and nothing is remembered after the tab is closed.',
        ],
      },
      {
        q: 'Who can see my information?',
        a: [
          'You see only your own loans and profile. Witik administrators can see applications to process them, and a credit investigator sees only the applications assigned to them. Every staff action — assignments, decisions, payments, verifications — is recorded in an audit log.',
        ],
      },
      {
        q: 'Can I change my personal details?',
        a: [
          'Yes — update your name, mobile number, birth date, address, employment and monthly income in Profile, then tap Save profile. Keep them accurate; they’re used to review your application.',
        ],
      },
    ],
  },
  {
    id: 'tips',
    title: 'Tips for a smooth loan',
    items: [
      {
        q: 'How can I get approved faster?',
        a: [
          [
            'Complete your profile with accurate, up-to-date details.',
            'Verify your identity before or right after you apply.',
            'Answer calls or messages from your credit investigator promptly.',
            'Borrow only what you need, and keep the monthly payment within 40% of your income.',
          ],
        ],
      },
      {
        q: 'Tips for clear ID photos',
        a: [
          [
            'Place the ID on a flat, dark surface with good light.',
            'Make sure all four corners are visible and the text is readable — no glare, blur or fingers covering details.',
            'For the selfie, face the camera in good light and hold the ID next to your face, not covering it.',
            'Use an ID that is valid and not expired.',
          ],
        ],
      },
      {
        q: 'Tips to avoid penalties',
        a: [
          [
            'Note your due dates from the repayment schedule and pay a few days early.',
            'If you miss a date, pay the full “Pay now” amount as soon as possible — penalties stop only when everything overdue is paid.',
            'Keep every payment reference number until it appears under Payments.',
            'If you know you’ll have trouble paying, contact Witik before the due date.',
          ],
        ],
      },
      {
        q: 'Tips to keep your account safe',
        a: [
          [
            'Never share your password with anyone, including people claiming to be from Witik.',
            'Use a password you don’t use on other sites.',
            'Sign out when you finish, especially on shared devices.',
          ],
        ],
      },
    ],
  },
  {
    id: 'staff',
    title: 'For Witik staff',
    items: [
      {
        q: 'How do staff sign in?',
        a: [
          'Staff use the same sign-in screen. Admin, Credit Investigator and Cashier accounts open the staff console automatically instead of the borrower app.',
        ],
      },
      {
        q: 'What can each role do?',
        a: [
          [
            'Admin — overview metrics, assign credit investigators, approve or reject applications, verify identities, add or deactivate staff, and read the audit log. Admins can also release loans and record payments as a backup for cashiers.',
            'Credit Investigator — sees only applications assigned to them, reviews the borrower’s ID and selfie, and files an investigation report (employment, income and residence checks, risk rating and recommendation).',
            'Cashier — releases approved loans to borrowers and accepts their monthly payments (including penalties). Cashiers see only approved, active and paid loans — not pending applications, ID photos or investigation reports. Every release and payment records which cashier handled it.',
          ],
        ],
      },
      {
        q: 'What rules does the system enforce?',
        a: [
          [
            'Loans move only forward: Pending → Approved → Active → Paid off, or Rejected / Cancelled.',
            'A loan cannot be approved until the borrower’s identity is verified, and a rejection needs a reason.',
            'Payments go to penalties first and can’t exceed what is owed; the loan closes automatically when fully paid.',
            'Every action is written to the audit log.',
          ],
        ],
      },
    ],
  },
]
