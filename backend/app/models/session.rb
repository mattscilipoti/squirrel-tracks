# frozen_string_literal: true

class Session < ApplicationRecord
  has_many :tasks, dependent: :destroy

  enum :status, { active: 0, completed: 1 }

  after_initialize :set_default_status, if: :new_record?

  validates :status, presence: true, inclusion: { in: statuses.keys }

  private

  def set_default_status
    self.status ||= :active
  end
end
