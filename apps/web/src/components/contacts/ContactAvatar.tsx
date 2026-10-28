"use client";

import { useState } from "react";
import { avatarStyle, getInitials } from "./utils";

interface ContactAvatarProps {
  name: string;
  photoUrl?: string;
  size?: number;
  className?: string;
  /** Image plus petite (px naturels) = image de repli du service → initiales. */
  minImageSize?: number;
}

export function ContactAvatar({ name, photoUrl, size = 36, className = "", minImageSize = 0 }: ContactAvatarProps) {
  const style = avatarStyle(name);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (photoUrl && photoUrl !== failedUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setFailedUrl(photoUrl)}
        onLoad={(e) => {
          if (e.currentTarget.naturalWidth < minImageSize) setFailedUrl(photoUrl);
        }}
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
