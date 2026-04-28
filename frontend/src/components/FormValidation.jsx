import { AnimatePresence, motion } from 'framer-motion';
import { useState, useCallback, useMemo } from 'react';

/**
 * Validation status icons
 */
export const ValidationIcon = ({ status, size = 16 }) => {
  const icons = {
    valid: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    invalid: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
    warning: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    pending: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  };

  return icons[status] || null;
};

/**
 * FormField — labelled input wrapper with enhanced validation state.
 * Props: label, error, touched, valid, warning, children, required, showIcon
 */
export function FormField({ 
  label, 
  error, 
  touched, 
  valid, 
  warning, 
  children, 
  required,
  showIcon = true,
  helpText,
  className = ''
}) {
  const getStatus = () => {
    if (!touched) return 'pending';
    if (error) return 'invalid';
    if (warning) return 'warning';
    if (valid) return 'valid';
    return 'pending';
  };

  const status = getStatus();

  return (
    <div className={`form-field ${className}`} style={{ marginBottom: 16 }}>
      {label && (
        <label style={{ 
          display: 'flex', 
          alignItems: 'center', 
          fontSize: 13, 
          fontWeight: 600, 
          marginBottom: 6, 
          color: '#374151' 
        }}>
          <span>{label}</span>
          {required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
          {showIcon && touched && (
            <span style={{ marginLeft: 'auto' }}>
              <ValidationIcon status={status} size={14} />
            </span>
          )}
        </label>
      )}
      
      <div style={{ position: 'relative' }}>
        {children}
      </div>

      {helpText && !error && !warning && (
        <p style={{ 
          fontSize: 12, 
          color: '#6b7280', 
          marginTop: 4,
          marginBottom: 0 
        }}>
          {helpText}
        </p>
      )}

      <AnimatePresence>
        {touched && error && (
          <motion.p
            className="field-error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            style={{ 
              fontSize: 12, 
              color: '#ef4444', 
              marginTop: 4,
              marginBottom: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <ValidationIcon status="invalid" size={12} />
            {error}
          </motion.p>
        )}
        {touched && warning && !error && (
          <motion.p
            className="field-warning"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            style={{ 
              fontSize: 12, 
              color: '#f59e0b', 
              marginTop: 4,
              marginBottom: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <ValidationIcon status="warning" size={12} />
            {warning}
          </motion.p>
        )}
        {touched && valid && !error && !warning && (
          <motion.p
            className="field-valid"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            style={{ 
              fontSize: 12, 
              color: '#10b981', 
              marginTop: 4,
              marginBottom: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <ValidationIcon status="valid" size={12} />
            Looks good!
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * FormProgress — progress indicator for form completion
 */
export function FormProgress({ 
  totalFields, 
  completedFields, 
  showPercentage = true,
  showCount = true,
  height = 8,
  color = '#3b82f6'
}) {
  const percentage = totalFields > 0 ? Math.round((completedFields / totalFields) * 100) : 0;

  return (
    <div className="form-progress" style={{ marginBottom: 16 }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: 6
      }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>
          Form Progress
        </span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          {showCount && `${completedFields}/${totalFields} fields`}
          {showCount && showPercentage && ' • '}
          {showPercentage && `${percentage}%`}
        </span>
      </div>
      <div style={{ 
        width: '100%', 
        height, 
        backgroundColor: '#e5e7eb', 
        borderRadius: height / 2,
        overflow: 'hidden'
      }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          style={{ 
            height: '100%', 
            backgroundColor: color,
            borderRadius: height / 2
          }}
        />
      </div>
    </div>
  );
}

/**
 * ValidationSummary — form-level validation summary
 */
export function ValidationSummary({ 
  errors, 
  warnings = [],
  title = 'Please fix the following errors:',
  showWarnings = true
}) {
  if (errors.length === 0 && (!showWarnings || warnings.length === 0)) {
    return null;
  }

  return (
    <motion.div
      className="validation-summary"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      style={{
        backgroundColor: errors.length > 0 ? '#fef2f2' : '#fffbeb',
        border: `1px solid ${errors.length > 0 ? '#fecaca' : '#fde68a'}`,
        borderRadius: 8,
        padding: 12,
        marginBottom: 16
      }}
    >
      {errors.length > 0 && (
        <>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8,
            marginBottom: 8
          }}>
            <ValidationIcon status="invalid" size={16} />
            <span style={{ 
              fontSize: 13, 
              fontWeight: 600, 
              color: '#991b1b' 
            }}>
              {title}
            </span>
          </div>
          <ul style={{ 
            margin: 0, 
            paddingLeft: 20, 
            fontSize: 12, 
            color: '#991b1b' 
          }}>
            {errors.map((error, index) => (
              <li key={index} style={{ marginBottom: 4 }}>{error}</li>
            ))}
          </ul>
        </>
      )}
      
      {showWarnings && warnings.length > 0 && (
        <>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8,
            marginBottom: 8,
            marginTop: errors.length > 0 ? 12 : 0
          }}>
            <ValidationIcon status="warning" size={16} />
            <span style={{ 
              fontSize: 13, 
              fontWeight: 600, 
              color: '#92400e' 
            }}>
              Warnings:
            </span>
          </div>
          <ul style={{ 
            margin: 0, 
            paddingLeft: 20, 
            fontSize: 12, 
            color: '#92400e' 
          }}>
            {warnings.map((warning, index) => (
              <li key={index} style={{ marginBottom: 4 }}>{warning}</li>
            ))}
          </ul>
        </>
      )}
    </motion.div>
  );
}

/**
 * useFormValidation — hook for managing form validation state
 */
export function useFormValidation(initialState = {}) {
  const [values, setValues] = useState(initialState);
  const [errors, setErrors] = useState({});
  const [warnings, setWarnings] = useState({});
  const [touched, setTouched] = useState({});

  const setValue = useCallback((field, value) => {
    setValues(prev => ({ ...prev, [field]: value }));
  }, []);

  const setError = useCallback((field, error) => {
    setErrors(prev => ({ ...prev, [field]: error }));
  }, []);

  const setWarning = useCallback((field, warning) => {
    setWarnings(prev => ({ ...prev, [field]: warning }));
  }, []);

  const setFieldTouched = useCallback((field, isTouched = true) => {
    setTouched(prev => ({ ...prev, [field]: isTouched }));
  }, []);

  const validateField = useCallback((field, validator) => {
    const error = validator(values[field], values);
    if (error) {
      setError(field, error);
    } else {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
    return error;
  }, [values, setError]);

  const validateForm = useCallback((validators) => {
    const newErrors = {};
    const newWarnings = {};
    
    Object.keys(validators).forEach(field => {
      const result = validators[field](values[field], values);
      if (result) {
        if (result.error) {
          newErrors[field] = result.error;
        }
        if (result.warning) {
          newWarnings[field] = result.warning;
        }
      }
    });

    setErrors(newErrors);
    setWarnings(newWarnings);
    
    return Object.keys(newErrors).length === 0;
  }, [values]);

  const reset = useCallback(() => {
    setValues(initialState);
    setErrors({});
    setWarnings({});
    setTouched({});
  }, [initialState]);

  const isValid = useMemo(() => {
    return Object.keys(errors).length === 0;
  }, [errors]);

  const completedFields = useMemo(() => {
    return Object.keys(values).filter(key => {
      const value = values[key];
      return value !== null && value !== undefined && value !== '';
    }).length;
  }, [values]);

  const totalFields = useMemo(() => Object.keys(values).length, [values]);

  return {
    values,
    errors,
    warnings,
    touched,
    setValue,
    setError,
    setWarning,
    setFieldTouched,
    validateField,
    validateForm,
    reset,
    isValid,
    completedFields,
    totalFields,
  };
}

/**
 * FormSubmitButton — button with validation state
 */
export function FormSubmitButton({ 
  isValid, 
  isSubmitting, 
  children, 
  disabled,
  ...props 
}) {
  const isDisabled = disabled || !isValid || isSubmitting;

  return (
    <motion.button
      type="submit"
      disabled={isDisabled}
      whileHover={!isDisabled ? { scale: 1.02 } : {}}
      whileTap={!isDisabled ? { scale: 0.98 } : {}}
      style={{
        width: '100%',
        padding: '12px 24px',
        backgroundColor: isDisabled ? '#9ca3af' : '#3b82f6',
        color: 'white',
        border: 'none',
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 600,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        transition: 'background-color 0.2s'
      }}
      {...props}
    >
      {isSubmitting && (
        <svg 
          width={16} 
          height={16} 
          viewBox="0 0 24 24" 
          style={{ animation: 'spin 1s linear infinite' }}
        >
          <circle 
            cx="12" 
            cy="12" 
            r="10" 
            stroke="currentColor" 
            strokeWidth="4" 
            fill="none" 
            strokeDasharray="31.42 31.42"
          />
        </svg>
      )}
      {children}
    </motion.button>
  );
}
