# frozen_string_literal: true

require "time"

module AgentNewsletter
  SourceItem = Data.define(
    :external_id,
    :source_name,
    :source_type,
    :name,
    :source_url,
    :summary,
    :published_at,
    :updated_at,
    :authors,
    :tags,
    :metadata,
    :source_authority_score
  ) do
    def to_h
      {
        external_id: external_id,
        source_name: source_name,
        source_type: source_type,
        name: name,
        source_url: source_url,
        summary: summary,
        published_at: published_at&.utc&.iso8601,
        updated_at: updated_at&.utc&.iso8601,
        authors: authors,
        tags: tags,
        metadata: metadata,
        source_authority_score: source_authority_score
      }
    end
  end
end
