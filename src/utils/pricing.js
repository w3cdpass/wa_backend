import { config } from '../config/index.js';

export const calculateCampaignCost = (contactCount, mediaType = 'none') => {
  const basePrice = config.pricing.text;
  const mediaMultiplier = {
    none: 1,
    image: config.pricing.image / config.pricing.text,
    video: config.pricing.video / config.pricing.text,
    pdf: config.pricing.pdf / config.pricing.text,
  };
  return Math.ceil(contactCount * basePrice * (mediaMultiplier[mediaType] || 1));
};

export const getPricing = () => ({
  text: config.pricing.text,
  image: config.pricing.image,
  video: config.pricing.video,
  pdf: config.pricing.pdf,
});