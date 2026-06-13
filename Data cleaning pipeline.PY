"""
data_cleaning_pipeline.py

A reusable, configurable data-cleaning pipeline for tabular data.

Typical usage
-------------
    import pandas as pd
    from data_cleaning_pipeline import DataCleaningPipeline

    df = pd.read_csv("raw_orders.csv")

    pipeline = DataCleaningPipeline(df)
    pipeline.remove_duplicates()
    pipeline.standardize_text(["customer_name", "email"])
    pipeline.standardize_categorical("region", REGION_MAP, default="Unknown")
    pipeline.standardize_categorical("payment_method", PAYMENT_MAP, default="Unknown")
    pipeline.parse_dates("order_date", formats=["%Y-%m-%d", "%m/%d/%Y", "%d-%b-%Y"])
    pipeline.clean_currency("unit_price")
    pipeline.fix_negative_values("quantity", strategy="abs")
    pipeline.recompute_column("total_amount", lambda d: d["quantity"] * d["unit_price"])
    pipeline.handle_missing({
        "email": "Unknown",
        "category": "mode",
        "quantity": "median",
        "unit_price": "median",
    })
    pipeline.flag_outliers("total_amount", method="iqr")

    cleaned_df, log = pipeline.run_summary()

Every transformation is recorded in `pipeline.log`, which can be handed to
`report.generate_html_report()` to produce a visual before/after report.
"""

import re
import numpy as np
import pandas as pd


class DataCleaningPipeline:
    """Applies a sequence of cleaning operations to a DataFrame while
    logging every change for later reporting."""

    def __init__(self, df: pd.DataFrame):
        self.df_raw = df.copy()
        self.df = df.copy()
        self.log = []

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _record(self, step, detail, rows_affected=0):
        self.log.append({"step": step, "detail": detail, "rows_affected": int(rows_affected)})

    def profile(self, df=None):
        """Return a snapshot of dataset health: shape, duplicates, missing values, dtypes."""
        df = df if df is not None else self.df
        return {
            "rows": len(df),
            "columns": len(df.columns),
            "duplicate_rows": int(df.duplicated().sum()),
            "missing_by_column": df.isna().sum().to_dict(),
            "missing_pct_by_column": (df.isna().mean() * 100).round(2).to_dict(),
            "dtypes": df.dtypes.astype(str).to_dict(),
        }

    # ------------------------------------------------------------------
    # Duplicates
    # ------------------------------------------------------------------
    def remove_duplicates(self, subset=None):
        before = len(self.df)
        self.df = self.df.drop_duplicates(subset=subset).reset_index(drop=True)
        removed = before - len(self.df)
        self._record(
            "remove_duplicates",
            f"Removed {removed} duplicate row(s)" + (f" based on {subset}" if subset else " (exact duplicates)"),
            removed,
        )
        return self

    # ------------------------------------------------------------------
    # Text standardization
    # ------------------------------------------------------------------
    def standardize_text(self, columns, case="title"):
        """Strip whitespace and normalize casing for free-text columns."""
        for col in columns:
            if col not in self.df.columns:
                continue
            before = self.df[col].copy()
            series = self.df[col].astype(str).str.strip()
            series = series.replace({"nan": np.nan, "None": np.nan, "": np.nan})
            if case == "title":
                series = series.str.title()
            elif case == "lower":
                series = series.str.lower()
            elif case == "upper":
                series = series.str.upper()
            changed = (before.astype(str) != series.astype(str)).sum()
            self.df[col] = series
            self._record("standardize_text", f"Trimmed/cased column '{col}'", changed)
        return self

    def standardize_categorical(self, column, mapping, default=None):
        """Map messy category labels to a canonical value using a
        case/whitespace-insensitive lookup dict."""
        if column not in self.df.columns:
            return self

        def normalize(val):
            if pd.isna(val):
                return val
            key = str(val).strip().lower()
            if key in mapping:
                return mapping[key]
            return default if default is not None else val

        before = self.df[column].copy()
        self.df[column] = self.df[column].apply(normalize)
        changed = (before.astype(str) != self.df[column].astype(str)).sum()
        self._record("standardize_categorical", f"Normalized labels in '{column}'", changed)
        return self

    # ------------------------------------------------------------------
    # Dates
    # ------------------------------------------------------------------
    def parse_dates(self, column, formats=None):
        """Parse a date column that may contain multiple formats."""
        if column not in self.df.columns:
            return self
        formats = formats or ["%Y-%m-%d", "%m/%d/%Y", "%d-%b-%Y", "%m-%d-%Y", "%d/%m/%Y"]

        def parse_value(val):
            if pd.isna(val):
                return pd.NaT
            s = str(val).strip()
            for fmt in formats:
                try:
                    return pd.to_datetime(s, format=fmt)
                except (ValueError, TypeError):
                    continue
            return pd.to_datetime(s, errors="coerce")

        parsed = self.df[column].apply(parse_value)
        unparsed = parsed.isna().sum() - self.df[column].isna().sum()
        self.df[column] = parsed
        self._record(
            "parse_dates",
            f"Parsed '{column}' into datetime "
            + (f"({unparsed} value(s) could not be parsed)" if unparsed > 0 else "(all values parsed)"),
            len(self.df) - unparsed,
        )
        return self

    # ------------------------------------------------------------------
    # Numeric / currency cleanup
    # ------------------------------------------------------------------
    def clean_currency(self, column):
        """Strip currency symbols/thousands separators and convert to float."""
        if column not in self.df.columns:
            return self
        before = self.df[column].copy()

        def to_number(val):
            if pd.isna(val):
                return np.nan
            s = re.sub(r"[^0-9.\-]", "", str(val))
            if s in ("", "-", "."):
                return np.nan
            try:
                return float(s)
            except ValueError:
                return np.nan

        self.df[column] = self.df[column].apply(to_number)
        changed = (before.astype(str) != self.df[column].astype(str)).sum()
        self._record("clean_currency", f"Converted '{column}' to numeric", changed)
        return self

    def fix_negative_values(self, column, strategy="abs"):
        """Fix negative values in a column that should always be positive."""
        if column not in self.df.columns:
            return self
        mask = self.df[column] < 0
        n = int(mask.sum())
        if n == 0:
            self._record("fix_negative_values", f"No negative values found in '{column}'", 0)
            return self
        if strategy == "abs":
            self.df.loc[mask, column] = self.df.loc[mask, column].abs()
            detail = f"Converted {n} negative value(s) in '{column}' to positive (abs)"
        elif strategy == "nan":
            self.df.loc[mask, column] = np.nan
            detail = f"Set {n} negative value(s) in '{column}' to missing"
        else:
            raise ValueError("strategy must be 'abs' or 'nan'")
        self._record("fix_negative_values", detail, n)
        return self

    def recompute_column(self, column, formula, tolerance=0.01):
        """Recompute a derived column (e.g. total = quantity * unit_price) where
        the stored value disagrees with the formula beyond `tolerance`."""
        if column not in self.df.columns:
            return self
        computed = formula(self.df)
        existing = pd.to_numeric(self.df[column], errors="coerce")
        mismatch = (existing - computed).abs() > tolerance
        mismatch = mismatch.fillna(True)
        n = int(mismatch.sum())
        self.df.loc[mismatch, column] = computed[mismatch]
        self._record("recompute_column", f"Recomputed {n} inconsistent value(s) in '{column}'", n)
        return self

    # ------------------------------------------------------------------
    # Missing values
    # ------------------------------------------------------------------
    def handle_missing(self, strategies: dict):
        """strategies: dict mapping column -> 'median' | 'mean' | 'mode' | 'drop_rows' | literal value"""
        for col, strategy in strategies.items():
            if col not in self.df.columns:
                continue
            n_missing = int(self.df[col].isna().sum())
            if n_missing == 0:
                continue
            if strategy == "median":
                fill = self.df[col].median()
                self.df[col] = self.df[col].fillna(fill)
                detail = f"Filled {n_missing} missing value(s) in '{col}' with median ({fill:.2f})"
            elif strategy == "mean":
                fill = self.df[col].mean()
                self.df[col] = self.df[col].fillna(fill)
                detail = f"Filled {n_missing} missing value(s) in '{col}' with mean ({fill:.2f})"
            elif strategy == "mode":
                fill = self.df[col].mode().iloc[0] if not self.df[col].mode().empty else "Unknown"
                self.df[col] = self.df[col].fillna(fill)
                detail = f"Filled {n_missing} missing value(s) in '{col}' with most common value ('{fill}')"
            elif strategy == "drop_rows":
                self.df = self.df.dropna(subset=[col]).reset_index(drop=True)
                detail = f"Dropped {n_missing} row(s) with missing '{col}' (required field)"
            else:
                self.df[col] = self.df[col].fillna(strategy)
                detail = f"Filled {n_missing} missing value(s) in '{col}' with '{strategy}'"
            self._record("handle_missing", detail, n_missing)
        return self

    # ------------------------------------------------------------------
    # Outliers
    # ------------------------------------------------------------------
    def flag_outliers(self, column, method="iqr", k=1.5):
        """Add a boolean `<column>_outlier` flag column. Outliers are flagged,
        not removed, so a human can review them."""
        if column not in self.df.columns:
            return self
        series = pd.to_numeric(self.df[column], errors="coerce")
        if method == "iqr":
            q1, q3 = series.quantile(0.25), series.quantile(0.75)
            iqr = q3 - q1
            lower, upper = q1 - k * iqr, q3 + k * iqr
            flags = (series < lower) | (series > upper)
        else:
            raise ValueError("Only method='iqr' is currently supported")
        self.df[f"{column}_outlier"] = flags.fillna(False)
        self._record("flag_outliers", f"Flagged {int(flags.sum())} outlier(s) in '{column}' (IQR method)", int(flags.sum()))
        return self

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    def quality_score(self, df=None):
        """A simple 0-100 data-quality score: share of cells that are
        non-missing, combined with a penalty for duplicate rows."""
        df = df if df is not None else self.df
        if len(df) == 0 or len(df.columns) == 0:
            return 0.0
        completeness = 1 - df.isna().mean().mean()
        dup_penalty = df.duplicated().sum() / len(df)
        score = max(0.0, (completeness - dup_penalty)) * 100
        return round(score, 1)

    def run_summary(self):
        """Return the cleaned DataFrame and the full transformation log,
        plus before/after profiles and quality scores."""
        summary = {
            "before": self.profile(self.df_raw),
            "after": self.profile(self.df),
            "quality_before": self.quality_score(self.df_raw),
            "quality_after": self.quality_score(self.df),
            "log": self.log,
        }
        return self.df, summary