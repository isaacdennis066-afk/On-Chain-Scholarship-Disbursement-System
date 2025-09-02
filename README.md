# 📚 On-Chain Scholarship Disbursement System

Welcome to a transparent and automated way to handle scholarship disbursements! This project uses the Stacks blockchain and Clarity smart contracts to verify academic achievements on-chain, ensuring funds are released only when criteria are met. By eliminating manual administration, it reduces opportunities for corruption in educational funding.

## ✨ Features

🔒 On-chain verification of grades, diplomas, and other achievements  
💰 Automated fund disbursement upon successful verification  
📊 Transparent audit trails for all transactions and decisions  
🏆 Support for multiple scholarship types with customizable criteria  
👥 Role-based access for donors, students, and verifiers  
🚫 Anti-fraud measures like unique achievement hashing and duplicate prevention  

## 🛠 How It Works

This system comprises 8 interconnected Clarity smart contracts that handle everything from fund management to verification and payout. Here's a high-level overview:

- **ScholarshipCreator.clar**: Allows donors to create new scholarships, defining criteria (e.g., GPA thresholds, course completions) and depositing funds.  
- **StudentRegistry.clar**: Enables students to register profiles and submit hashed academic data (e.g., transcripts).  
- **AchievementVerifier.clar**: Integrates with trusted oracles to confirm submitted achievements against real-world data.  
- **ApplicationManager.clar**: Handles student applications to specific scholarships, linking profiles to criteria.  
- **EvaluationEngine.clar**: Automatically evaluates applications against scholarship rules, using on-chain logic for approvals.  
- **FundEscrow.clar**: Securely holds scholarship funds in escrow until conditions are met.  
- **DisbursementHandler.clar**: Triggers payouts to verified students via STX or custom tokens.  
- **AuditLogger.clar**: Records all actions immutably for transparency and dispute resolution.  

**For Donors**  
- Deploy a scholarship via ScholarshipCreator, specifying rules and funding it.  
- Monitor progress through AuditLogger queries.  

**For Students**  
- Register on StudentRegistry with your details.  
- Apply via ApplicationManager, submitting verifiable achievement hashes.  
- Once verified and evaluated, funds are auto-disbursed.  

**For Verifiers/Oracles**  
- Use AchievementVerifier to input off-chain confirmations securely.  
- Everything is logged for accountability.  

That's it! No more paperwork or middlemen—pure blockchain efficiency.