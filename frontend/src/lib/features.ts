function isEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true';
}

export function isEsimEnabled() {
  return isEnabled(process.env.NEXT_PUBLIC_ENABLE_ESIM);
}

export function isDevicesEnabled() {
  return isEnabled(process.env.NEXT_PUBLIC_ENABLE_DEVICES);
}

export function isMerchandiseEnabled() {
  return isEnabled(process.env.NEXT_PUBLIC_ENABLE_MERCHANDISE);
}

export function isUspBarEnabled() {
  return isEnabled(process.env.NEXT_PUBLIC_SHOW_USP_BAR);
}
