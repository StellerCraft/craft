#!/bin/bash

##
# Template Dependency Security Scanning Script
#
# Scans all template dependencies for known vulnerabilities using npm audit.
# Generates security reports and integrates with CI/CD pipeline.
#
# Usage:
#   ./scripts/security-scan.sh [--fix] [--json] [--strict]
#
# Options:
#   --fix       Attempt to fix vulnerabilities automatically
#   --json      Output results in JSON format
#   --strict    Exit with error on any vulnerability (default: only critical)
#

set -e

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TEMPLATES_DIR="templates"
REPORTS_DIR="security-reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="${REPORTS_DIR}/security-scan-${TIMESTAMP}.json"
SUMMARY_FILE="${REPORTS_DIR}/security-summary-${TIMESTAMP}.txt"

# Parse arguments
FIX_MODE=false
JSON_OUTPUT=false
STRICT_MODE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --fix)
      FIX_MODE=true
      shift
      ;;
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    --strict)
      STRICT_MODE=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Create reports directory
mkdir -p "${REPORTS_DIR}"

echo -e "${BLUE}=== Template Dependency Security Scan ===${NC}"
echo "Timestamp: $(date)"
echo "Strict Mode: ${STRICT_MODE}"
echo "Fix Mode: ${FIX_MODE}"
echo ""

# Initialize counters
TOTAL_VULNERABILITIES=0
CRITICAL_VULNERABILITIES=0
HIGH_VULNERABILITIES=0
MEDIUM_VULNERABILITIES=0
LOW_VULNERABILITIES=0
SCANNED_TEMPLATES=0
FAILED_TEMPLATES=0

# Initialize JSON report
if [ "$JSON_OUTPUT" = true ]; then
  echo "{" > "${REPORT_FILE}"
  echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," >> "${REPORT_FILE}"
  echo "  \"templates\": [" >> "${REPORT_FILE}"
fi

# Scan each template
FIRST_TEMPLATE=true
for template_dir in "${TEMPLATES_DIR}"/*; do
  if [ -d "${template_dir}" ] && [ -f "${template_dir}/package.json" ]; then
    template_name=$(basename "${template_dir}")
    echo -e "${BLUE}Scanning: ${template_name}${NC}"
    
    SCANNED_TEMPLATES=$((SCANNED_TEMPLATES + 1))
    
    # Run npm audit
    cd "${template_dir}"
    
    if [ "$FIX_MODE" = true ]; then
      npm audit fix --audit-level=moderate 2>/dev/null || true
    fi
    
    # Get audit results
    AUDIT_OUTPUT=$(npm audit --json 2>/dev/null || echo "{}")
    
    # Parse vulnerability counts
    CRITICAL=$(echo "${AUDIT_OUTPUT}" | grep -o '"critical":[0-9]*' | grep -o '[0-9]*' || echo "0")
    HIGH=$(echo "${AUDIT_OUTPUT}" | grep -o '"high":[0-9]*' | grep -o '[0-9]*' || echo "0")
    MEDIUM=$(echo "${AUDIT_OUTPUT}" | grep -o '"medium":[0-9]*' | grep -o '[0-9]*' || echo "0")
    LOW=$(echo "${AUDIT_OUTPUT}" | grep -o '"low":[0-9]*' | grep -o '[0-9]*' || echo "0")
    
    TEMPLATE_TOTAL=$((CRITICAL + HIGH + MEDIUM + LOW))
    
    # Update totals
    TOTAL_VULNERABILITIES=$((TOTAL_VULNERABILITIES + TEMPLATE_TOTAL))
    CRITICAL_VULNERABILITIES=$((CRITICAL_VULNERABILITIES + CRITICAL))
    HIGH_VULNERABILITIES=$((HIGH_VULNERABILITIES + HIGH))
    MEDIUM_VULNERABILITIES=$((MEDIUM_VULNERABILITIES + MEDIUM))
    LOW_VULNERABILITIES=$((LOW_VULNERABILITIES + LOW))
    
    # Display results
    if [ "$TEMPLATE_TOTAL" -gt 0 ]; then
      echo -e "${RED}  ✗ Found ${TEMPLATE_TOTAL} vulnerabilities${NC}"
      [ "$CRITICAL" -gt 0 ] && echo -e "    ${RED}Critical: ${CRITICAL}${NC}"
      [ "$HIGH" -gt 0 ] && echo -e "    ${RED}High: ${HIGH}${NC}"
      [ "$MEDIUM" -gt 0 ] && echo -e "    ${YELLOW}Medium: ${MEDIUM}${NC}"
      [ "$LOW" -gt 0 ] && echo -e "    ${YELLOW}Low: ${LOW}${NC}"
    else
      echo -e "${GREEN}  ✓ No vulnerabilities found${NC}"
    fi
    
    # Add to JSON report
    if [ "$JSON_OUTPUT" = true ]; then
      if [ "$FIRST_TEMPLATE" = false ]; then
        echo "," >> "${REPORT_FILE}"
      fi
      FIRST_TEMPLATE=false
      
      echo "    {" >> "${REPORT_FILE}"
      echo "      \"name\": \"${template_name}\"," >> "${REPORT_FILE}"
      echo "      \"vulnerabilities\": {" >> "${REPORT_FILE}"
      echo "        \"critical\": ${CRITICAL}," >> "${REPORT_FILE}"
      echo "        \"high\": ${HIGH}," >> "${REPORT_FILE}"
      echo "        \"medium\": ${MEDIUM}," >> "${REPORT_FILE}"
      echo "        \"low\": ${LOW}," >> "${REPORT_FILE}"
      echo "        \"total\": ${TEMPLATE_TOTAL}" >> "${REPORT_FILE}"
      echo "      }" >> "${REPORT_FILE}"
      echo "    }" >> "${REPORT_FILE}"
    fi
    
    cd - > /dev/null
  fi
done

# Close JSON report
if [ "$JSON_OUTPUT" = true ]; then
  echo "" >> "${REPORT_FILE}"
  echo "  ]," >> "${REPORT_FILE}"
  echo "  \"summary\": {" >> "${REPORT_FILE}"
  echo "    \"scanned\": ${SCANNED_TEMPLATES}," >> "${REPORT_FILE}"
  echo "    \"total_vulnerabilities\": ${TOTAL_VULNERABILITIES}," >> "${REPORT_FILE}"
  echo "    \"critical\": ${CRITICAL_VULNERABILITIES}," >> "${REPORT_FILE}"
  echo "    \"high\": ${HIGH_VULNERABILITIES}," >> "${REPORT_FILE}"
  echo "    \"medium\": ${MEDIUM_VULNERABILITIES}," >> "${REPORT_FILE}"
  echo "    \"low\": ${LOW_VULNERABILITIES}" >> "${REPORT_FILE}"
  echo "  }" >> "${REPORT_FILE}"
  echo "}" >> "${REPORT_FILE}"
fi

# Generate summary
echo "" | tee -a "${SUMMARY_FILE}"
echo "=== Security Scan Summary ===" | tee -a "${SUMMARY_FILE}"
echo "Templates Scanned: ${SCANNED_TEMPLATES}" | tee -a "${SUMMARY_FILE}"
echo "Total Vulnerabilities: ${TOTAL_VULNERABILITIES}" | tee -a "${SUMMARY_FILE}"
echo "  Critical: ${CRITICAL_VULNERABILITIES}" | tee -a "${SUMMARY_FILE}"
echo "  High: ${HIGH_VULNERABILITIES}" | tee -a "${SUMMARY_FILE}"
echo "  Medium: ${MEDIUM_VULNERABILITIES}" | tee -a "${SUMMARY_FILE}"
echo "  Low: ${LOW_VULNERABILITIES}" | tee -a "${SUMMARY_FILE}"
echo "" | tee -a "${SUMMARY_FILE}"

if [ "$JSON_OUTPUT" = true ]; then
  echo "Report saved to: ${REPORT_FILE}" | tee -a "${SUMMARY_FILE}"
fi

# Determine exit code
EXIT_CODE=0

if [ "$STRICT_MODE" = true ] && [ "$TOTAL_VULNERABILITIES" -gt 0 ]; then
  echo -e "${RED}✗ Strict mode: Failing due to vulnerabilities${NC}" | tee -a "${SUMMARY_FILE}"
  EXIT_CODE=1
elif [ "$CRITICAL_VULNERABILITIES" -gt 0 ]; then
  echo -e "${RED}✗ Critical vulnerabilities found${NC}" | tee -a "${SUMMARY_FILE}"
  EXIT_CODE=1
elif [ "$HIGH_VULNERABILITIES" -gt 0 ]; then
  echo -e "${YELLOW}⚠ High severity vulnerabilities found${NC}" | tee -a "${SUMMARY_FILE}"
  EXIT_CODE=0
else
  echo -e "${GREEN}✓ Security scan passed${NC}" | tee -a "${SUMMARY_FILE}"
  EXIT_CODE=0
fi

echo ""
exit ${EXIT_CODE}
