-- Every Campaign needs a catch-all channel for participant answers that do not
-- match a known acquisition channel.
UPDATE campaign_channels
SET archived_at = NULL
WHERE code = 'other' OR name = 'その他';

INSERT INTO campaign_channels (campaign_id, name, code, sort_order)
SELECT campaign.id, 'その他', 'other', 2147483647
FROM campaigns AS campaign
WHERE NOT EXISTS (
  SELECT 1
  FROM campaign_channels AS channel
  WHERE channel.campaign_id = campaign.id
    AND (channel.code = 'other' OR channel.name = 'その他')
);
