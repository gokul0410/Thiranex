import pandas as pd
import matplotlib.pyplot as plt
import os

# Create reports folder
os.makedirs("reports", exist_ok=True)

# Load Dataset
df = pd.read_csv("data.csv")

print("Original Shape:", df.shape)

# -----------------------------
# DATA CLEANING
# -----------------------------

# Standardize column names
df.columns = df.columns.str.strip().str.lower().str.replace(" ", "_")

# Remove duplicates
duplicates = df.duplicated().sum()
df.drop_duplicates(inplace=True)

# Handle missing values
for col in df.columns:
    if df[col].dtype == "object":
        df[col].fillna(df[col].mode()[0], inplace=True)
    else:
        df[col].fillna(df[col].mean(), inplace=True)

# Remove leading/trailing spaces
for col in df.select_dtypes(include="object"):
    df[col] = df[col].str.strip()

print("Duplicates Removed:", duplicates)
print("Cleaned Shape:", df.shape)

# -----------------------------
# SAVE CLEANED DATA
# -----------------------------

cleaned_file = "reports/cleaned_data.xlsx"
df.to_excel(cleaned_file, index=False)

# -----------------------------
# SUMMARY REPORT
# -----------------------------

summary = pd.DataFrame({
    "Column": df.columns,
    "Missing Values": df.isnull().sum().values,
    "Data Type": df.dtypes.values
})

summary_file = "reports/summary_report.xlsx"

with pd.ExcelWriter(summary_file) as writer:
    summary.to_excel(writer, sheet_name="Data Summary", index=False)
    df.describe(include="all").to_excel(writer, sheet_name="Statistics")

# -----------------------------
# VISUAL REPORT
# -----------------------------

numeric_cols = df.select_dtypes(include="number").columns

if len(numeric_cols) > 0:
    first_col = numeric_cols[0]

    plt.figure(figsize=(8, 5))
    df[first_col].hist(bins=20)

    plt.title(f"Distribution of {first_col}")
    plt.xlabel(first_col)
    plt.ylabel("Frequency")

    plt.tight_layout()
    plt.savefig("reports/sales_chart.png")
    plt.close()

# -----------------------------
# CONSOLE REPORT
# -----------------------------

print("\n===== REPORT GENERATED =====")
print("Cleaned Data :", cleaned_file)
print("Summary Report :", summary_file)
print("Chart Saved : reports/sales_chart.png")