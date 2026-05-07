"use client";

import { avatarStyle, getInitials } from "./utils";

interface ContactAvatarProps {
  name: string;
  photoUrl?: string;
  size?: number;
  className?: string;
}

export function ContactAvatar({ name, photoUrl, size = 36, className = "" }: ContactAvatarProps) {
  const style = avatarStyle(name);

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size, minWidth: size }}
      />
    );
  }

  return (
    <div
      className={`flex items-center justify-center rounded-full font-semibold select-none ${className}`}
      style={{
        ...style,
        width: size,
        height: size,
        minWidth: size,
        fontSize: size * 0.38,
      }}
    >
      {getInitials(name)}
    </div>
  );
}
