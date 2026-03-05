import React from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'sparkle';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
  children?: React.ReactNode;
}

const Button = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  onClick, 
  className = '', 
  disabled = false, 
  loading = false, 
  ...props 
}: any) => {
  const base = "inline-flex items-center justify-center font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-600/20",
    secondary: "bg-zinc-900 text-zinc-100 hover:bg-zinc-800 border border-zinc-800",
    ghost: "text-zinc-600 hover:text-white hover:bg-zinc-900",
    sparkle: "bg-gradient-to-br from-indigo-500 to-blue-600 text-white hover:opacity-90 shadow-lg shadow-indigo-600/20"
  };
  
  const sizeClasses = size === 'icon' ? 'p-2' : 'px-4 py-2 text-sm';

  return (
    <button 
      className={`${base} ${variants[variant]} ${sizeClasses} ${className}`} 
      onClick={onClick} 
      disabled={disabled || loading} 
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
};

export default Button;
