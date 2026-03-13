# frozen_string_literal: true

require "time"

module AgentNewsletter
  module SourceAdapters
    class BaseAdapter
      def source_name
        raise NotImplementedError, "#{self.class} must implement #source_name"
      end

      def fetch(...)
        raise NotImplementedError, "#{self.class} must implement #fetch"
      end

      private

      def normalize_text(text)
        text.to_s.gsub(/\s+/, " ").strip
      end

      def parse_time(value)
        return if value.nil? || value.empty?

        Time.iso8601(value).utc
      rescue ArgumentError
        nil
      end
    end
  end
end
