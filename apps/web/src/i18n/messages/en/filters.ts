/** Filter condition editor (list views, reports, automations, approval processes) and one-line filter summaries. */
export default {
  /** Comparison operators, read as "<field> <operator> <value>", e.g. "Stage equals Closed Won". */
  operators: {
    eq: 'equals',
    neq: 'not equal to',
    contains: 'contains',
    not_contains: 'does not contain',
    starts_with: 'starts with',
    gt: 'greater than',
    gte: 'greater or equal',
    lt: 'less than',
    lte: 'less or equal',
    in: 'is any of',
    not_in: 'is none of',
    is_empty: 'is empty',
    is_not_empty: 'is not empty',
  },
  /** Relative dates a date condition can compare with (choices in a dropdown). */
  dates: {
    TODAY: 'Today',
    YESTERDAY: 'Yesterday',
    TOMORROW: 'Tomorrow',
    THIS_WEEK: 'This week',
    LAST_WEEK: 'Last week',
    NEXT_WEEK: 'Next week',
    THIS_MONTH: 'This month',
    LAST_MONTH: 'Last month',
    NEXT_MONTH: 'Next month',
    THIS_QUARTER: 'This quarter',
    LAST_QUARTER: 'Last quarter',
    NEXT_QUARTER: 'Next quarter',
    THIS_YEAR: 'This year',
    LAST_YEAR: 'Last year',
    NEXT_YEAR: 'Next year',
  },
  /** Text before the dropdown choosing how conditions combine: "Match [all conditions | any condition]". */
  match: 'Match',
  matchAll: 'all conditions',
  matchAny: 'any condition',
  /** Accessible name of the operator dropdown. */
  operator: 'Operator',
  /** Choices for a checkbox field's value. */
  valueTrue: 'True',
  valueFalse: 'False',
  /** Accessible name of the dropdown choosing a relative date or "Specific date". */
  dateValue: 'Date value',
  specificDate: 'Specific date',
  /** Accessible name of the dropdown choosing "Current user" or "Specific user". */
  userValue: 'User value',
  currentUser: 'Current user',
  specificUser: 'Specific user',
  removeCondition: 'Remove condition',
  addCondition: 'Add condition',
  noConditions: 'No conditions',
  /** Stands for the signed-in user in a filter summary, e.g. "Owner equals me". */
  me: 'me',
  describe: {
    /** One condition in a filter summary, e.g. "Stage equals Closed Won". */
    rule: '{field} {operator} {value}',
    /** A condition without a value, e.g. "Close Date is empty". */
    ruleNoValue: '{field} {operator}',
    /** Joins conditions that must all match, e.g. "Stage equals Closed Won AND Amount greater than 1000". */
    and: '{left} AND {right}',
    /** Joins conditions of which at least one must match. */
    or: '{left} OR {right}',
  },
};
