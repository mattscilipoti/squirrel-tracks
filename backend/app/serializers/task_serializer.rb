# frozen_string_literal: true

class TaskSerializer < ActiveModel::Serializer
  attributes :id, :name, :duration_minutes, :session_id, :created_at, :updated_at

  belongs_to :session, serializer: SessionSerializer
end
